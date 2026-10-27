"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { MAX_PRODUCT_IMAGE_BYTES, readUpload } from "@/lib/uploads";
import { firstError, productSchema } from "@/lib/validation";
import { PRODUCT_CSV_HEADER, parseBool, parseCsv } from "@/lib/csv";
import { parseFlavorPayload, removeUnreferencedImages, syncFlavors } from "@/lib/flavors-admin";
import { fetchAll } from "@/lib/fetch-all";
import { downloadImage } from "@/lib/remote-image";

export type FormState = { error?: string; ok?: string } | null;

function refresh() {
  revalidatePath("/admin/products");
  revalidatePath("/", "layout");
}

function dbError(message: string) {
  if (/products_sku_key|duplicate key/.test(message)) return "Another product already uses this SKU.";
  return "Could not save the product. Please try again.";
}

async function nextSortOrder() {
  const { supabase } = await requireAdmin();
  const { data } = await supabase.from("products").select("sort_order").order("sort_order", { ascending: false }).limit(1);
  return (data?.[0]?.sort_order ?? 0) + 10;
}

export async function saveProduct(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("id") ?? "") || null;

  const parsed = productSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    price: String(formData.get("price") ?? ""),
    sku: String(formData.get("sku") ?? ""),
    category: String(formData.get("category") ?? ""),
    catalog: String(formData.get("catalog") ?? "happy"),
    brand: String(formData.get("brand") ?? ""),
    description: String(formData.get("description") ?? ""),
    published: formData.get("published") === "on",
    sort_order: String(formData.get("sort_order") ?? "") || String(id ? 0 : await nextSortOrder()),
  });
  if (!parsed.success) return { error: firstError(parsed.error) };
  const { price, ...rest } = parsed.data;

  const flavors = parseFlavorPayload(formData.get("flavors_json"));
  if (flavors && "error" in flavors) return { error: flavors.error };

  const upload = await readUpload(formData.get("image"), MAX_PRODUCT_IMAGE_BYTES, ["image/jpeg", "image/png", "image/webp"]);
  if (upload && "error" in upload) return { error: upload.error };
  const removeImage = formData.get("remove_image") === "on";

  const productId = id ?? randomUUID();
  let previousImage: string | null = null;
  if (id) {
    const { data: existing } = await supabase.from("products").select("image_path").eq("id", id).maybeSingle();
    if (!existing) return { error: "This product no longer exists." };
    previousImage = existing.image_path;
  }

  const storage = createServiceClient().storage.from("product-images");
  let imagePath: string | null | undefined = undefined; // undefined = unchanged
  if (upload) {
    imagePath = `products/${productId}/${randomUUID()}.${upload.kind.ext}`;
    const { error } = await storage.upload(imagePath, upload.bytes, {
      contentType: upload.kind.mime,
      cacheControl: "31536000",
      upsert: false,
    });
    if (error) return { error: "Image upload failed. Please try again." };
  } else if (removeImage) {
    imagePath = null;
  }

  const row = { ...rest, price_cents: price, in_stock: formData.get("in_stock") === "on", ...(imagePath !== undefined ? { image_path: imagePath, image_source_url: null } : {}) };
  const { error } = id
    ? await supabase.from("products").update(row).eq("id", id)
    : await supabase.from("products").insert({ id: productId, ...row });

  if (error) {
    if (imagePath) await storage.remove([imagePath]);
    return { error: dbError(error.message) };
  }
  if (imagePath !== undefined && previousImage && previousImage !== imagePath) {
    await removeUnreferencedImages([previousImage]);
  }

  if (flavors) {
    const result = await syncFlavors(productId, flavors.rows, formData);
    if (result.error) {
      refresh();
      return { error: `Product saved, but flavors weren't fully updated: ${result.error}` };
    }
  }

  refresh();
  redirect(`/admin/products?saved=${encodeURIComponent(rest.name)}`);
}

export async function deleteProduct(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const { data } = await supabase.from("products").select("image_path").eq("id", id).maybeSingle();
  const { data: flavorImages } = await supabase.from("product_flavors").select("image_path").eq("product_id", id);
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (!error) await removeUnreferencedImages([data?.image_path, ...(flavorImages ?? []).map((f) => f.image_path as string | null)]);
  refresh();
  redirect("/admin/products");
}

export async function togglePublished(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const published = formData.get("published") === "true";
  await supabase.from("products").update({ published }).eq("id", id);
  refresh();
}

export async function toggleInStock(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const inStock = formData.get("in_stock") === "true";
  await supabase.from("products").update({ in_stock: inStock }).eq("id", id);
  refresh();
}

/** Move a product one place up or down in the catalog order. */
export async function moveProduct(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const dir = formData.get("dir") === "up" ? -1 : 1;

  // Products move within their own catalog (that's the order customers see).
  const { data: self } = await supabase.from("products").select("catalog").eq("id", id).maybeSingle();
  if (!self) return;
  const data = await fetchAll<{ id: string; sort_order: number }>((from, to) =>
    supabase.from("products").select("id, sort_order").eq("catalog", self.catalog).order("sort_order").order("name").order("id").range(from, to),
  );
  const list = data.map((p) => p.id);
  const i = list.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];

  // Renumber in steps of 10; only rows whose position changed are written.
  const current = new Map(data.map((p) => [p.id, p.sort_order]));
  const updates = list
    .map((pid, idx) => ({ id: pid, sort_order: (idx + 1) * 10 }))
    .filter((u) => current.get(u.id) !== u.sort_order);
  for (const u of updates) await supabase.from("products").update({ sort_order: u.sort_order }).eq("id", u.id);
  refresh();
}

export async function importProductsCsv(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();
  const file = formData.get("file");
  if (!file || typeof file === "string" || file.size === 0) return { error: "Choose a CSV file." };
  if (file.size > 2 * 1024 * 1024) return { error: "CSV must be 2 MB or smaller." };

  const rows = parseCsv(await file.text());
  if (rows.length < 2) return { error: "The CSV has no product rows." };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: (typeof PRODUCT_CSV_HEADER)[number]) => header.indexOf(name);
  if (col("name") < 0 || col("price") < 0) return { error: 'The CSV needs at least "name" and "price" columns.' };
  if (rows.length > 2001) return { error: "Import up to 2,000 products at a time." };

  const started = Date.now();
  type Existing = { id: string; sku: string | null; sort_order: number; catalog: string; brand: string | null; image_path: string | null; image_source_url: string | null };
  const existing = await fetchAll<Existing>((from, to) =>
    supabase.from("products").select("id, sku, sort_order, catalog, brand, image_path, image_source_url").order("id").range(from, to),
  );
  const byId = new Map(existing.map((p) => [p.id, p]));
  const imageJobs: { row: number; productId: string; url: string; previous: string | null }[] = [];
  const bySku = new Map(existing.filter((p) => p.sku).map((p) => [p.sku!.toLowerCase(), p.id]));
  let nextOrder = existing.reduce((m, p) => Math.max(m, p.sort_order), 0) + 10;

  let created = 0;
  let updated = 0;
  const problems: string[] = [];

  for (let r = 1; r < rows.length; r++) {
    const get = (name: (typeof PRODUCT_CSV_HEADER)[number]) => (col(name) >= 0 ? (rows[r][col(name)] ?? "").replace(/^'(?=[=+\-@])/, "") : undefined);
    const sku = get("sku")?.trim() || "";
    // Match an existing product by its id (from an export) first, then by SKU.
    const idCell = get("id")?.trim().toLowerCase() || "";
    const existingId = (idCell && byId.has(idCell) ? idCell : undefined) ?? (sku ? bySku.get(sku.toLowerCase()) : undefined);
    const before = existingId ? byId.get(existingId) : undefined;
    const sortRaw = get("sort_order")?.trim();
    // Missing or empty catalog keeps the product where it is (new products go to Happy).
    // A missing brand column keeps the current brand; an empty brand cell clears it.
    const catalogCell = get("catalog")?.trim().toLowerCase() || "";
    const brandCell = get("brand");

    const parsed = productSchema.safeParse({
      name: get("name") ?? "",
      price: get("price") ?? "",
      sku,
      category: get("category") ?? "",
      catalog: catalogCell || before?.catalog || "happy",
      brand: brandCell ?? before?.brand ?? "",
      description: get("description") ?? "",
      published: parseBool(get("published"), true),
      sort_order: sortRaw || String(before ? before.sort_order : nextOrder),
    });
    if (!parsed.success) {
      problems.push(`Row ${r + 1}: ${firstError(parsed.error)}`);
      continue;
    }
    const { price, ...rest } = parsed.data;
    const stockCell = get("in_stock")?.trim();
    // Only change stock when the column is present and filled in.
    const row = { ...rest, price_cents: price, ...(stockCell ? { in_stock: parseBool(stockCell, true) } : {}) };
    const { error, data } = existingId
      ? await supabase.from("products").update(row).eq("id", existingId).select("id").single()
      : await supabase.from("products").insert(row).select("id").single();
    if (error) {
      problems.push(`Row ${r + 1}: ${dbError(error.message)}`);
      continue;
    }
    // "flavors" column (names separated by ;): replaces the product's flavor list.
    // Left empty, the product's flavors are not changed.
    const flavorCell = get("flavors")?.trim();
    if (flavorCell && data) {
      const names = [...new Set(flavorCell.split(";").map((n) => n.trim()).filter(Boolean))];
      const { data: cur } = await supabase.from("product_flavors").select("id, name, in_stock").eq("product_id", data.id);
      const byName = new Map((cur ?? []).map((f) => [String(f.name).toLowerCase(), { id: f.id as string, inStock: f.in_stock !== false }]));
      // Existing flavors keep their stock setting; new ones start in stock.
      const rowsIn = names.map((name, k) => {
        const found = byName.get(name.toLowerCase());
        return { key: `csv${k}`, id: found?.id ?? null, name, inStock: found?.inStock ?? true };
      });
      const checked = parseFlavorPayload(JSON.stringify(rowsIn));
      const res = checked && "rows" in checked ? await syncFlavors(data.id, checked.rows) : { error: checked && "error" in checked ? checked.error : undefined };
      if (res.error) problems.push(`Row ${r + 1}: flavors — ${res.error}`);
    }

    // "image_url" column: download the picture into storage. Skipped when this
    // product already has the image from the same link (so re-imports are fast).
    const imageUrl = get("image_url")?.trim();
    if (imageUrl && data) {
      if (!/^https?:\/\/\S+$/i.test(imageUrl) || imageUrl.length > 2000) problems.push(`Row ${r + 1}: image_url isn't a valid http(s) link`);
      else if (!(before?.image_path && before.image_source_url === imageUrl))
        imageJobs.push({ row: r + 1, productId: data.id, url: imageUrl, previous: before?.image_path ?? null });
    }

    if (existingId) updated++;
    else {
      created++;
      if (!sortRaw) nextOrder += 10;
      if (sku && data) bySku.set(sku.toLowerCase(), data.id);
    }
  }

  // Download images a few at a time, within a time budget. Whatever doesn't
  // fit is picked up by running the same import again.
  const IMAGE_BUDGET_MS = 200_000;
  let imagesDone = 0;
  let imagesLeft = 0;
  const service = createServiceClient();
  const queue = [...imageJobs];
  const replaced: (string | null)[] = [];
  async function worker() {
    for (let job = queue.shift(); job; job = queue.shift()) {
      if (Date.now() - started > IMAGE_BUDGET_MS) {
        imagesLeft++;
        continue;
      }
      try {
        const img = await downloadImage(job.url);
        const path = `products/${job.productId}/${randomUUID()}.${img.ext}`;
        const { error: upErr } = await service.storage.from("product-images").upload(path, img.bytes, { contentType: img.mime, cacheControl: "31536000", upsert: false });
        if (upErr) throw new Error("upload to storage failed");
        const { error: dbErr } = await supabase.from("products").update({ image_path: path, image_source_url: job.url }).eq("id", job.productId);
        if (dbErr) {
          await service.storage.from("product-images").remove([path]);
          throw new Error("couldn't save the image");
        }
        replaced.push(job.previous);
        imagesDone++;
      } catch (e) {
        problems.push(`Row ${job.row}: image — ${e instanceof Error ? e.message : "download failed"}`);
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  await removeUnreferencedImages(replaced);

  refresh();
  const imageNote = imageJobs.length
    ? ` Images: ${imagesDone} downloaded${imagesLeft ? `, ${imagesLeft} still to do — run the same import again to continue` : ""}.`
    : "";
  const summary = `Imported: ${created} added, ${updated} updated.${imageNote}`;
  if (problems.length) return { error: `${summary} ${problems.length} skipped — ${problems.slice(0, 5).join("; ")}${problems.length > 5 ? "…" : ""}` };
  return { ok: summary };
}
