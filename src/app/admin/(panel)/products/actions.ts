"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { MAX_PRODUCT_IMAGE_BYTES, readUpload } from "@/lib/uploads";
import { firstError, productSchema } from "@/lib/validation";
import { PRODUCT_CSV_HEADER, parseBool, parseCsv } from "@/lib/csv";

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
    description: String(formData.get("description") ?? ""),
    published: formData.get("published") === "on",
    sort_order: String(formData.get("sort_order") ?? "") || String(id ? 0 : await nextSortOrder()),
  });
  if (!parsed.success) return { error: firstError(parsed.error) };
  const { price, ...rest } = parsed.data;

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

  const row = { ...rest, price_cents: price, ...(imagePath !== undefined ? { image_path: imagePath } : {}) };
  const { error } = id
    ? await supabase.from("products").update(row).eq("id", id)
    : await supabase.from("products").insert({ id: productId, ...row });

  if (error) {
    if (imagePath) await storage.remove([imagePath]);
    return { error: dbError(error.message) };
  }
  if (imagePath !== undefined && previousImage && previousImage !== imagePath) {
    await storage.remove([previousImage]);
  }

  refresh();
  redirect(`/admin/products?saved=${encodeURIComponent(rest.name)}`);
}

export async function deleteProduct(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const { data } = await supabase.from("products").select("image_path").eq("id", id).maybeSingle();
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (!error && data?.image_path) await createServiceClient().storage.from("product-images").remove([data.image_path]);
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

/** Move a product one place up or down in the catalog order. */
export async function moveProduct(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const dir = formData.get("dir") === "up" ? -1 : 1;

  const { data } = await supabase.from("products").select("id, sort_order").order("sort_order").order("name").order("id");
  if (!data) return;
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

  const { data: existing } = await supabase.from("products").select("id, sku, sort_order");
  const bySku = new Map((existing ?? []).filter((p) => p.sku).map((p) => [p.sku!.toLowerCase(), p.id]));
  let nextOrder = Math.max(0, ...(existing ?? []).map((p) => p.sort_order)) + 10;

  let created = 0;
  let updated = 0;
  const problems: string[] = [];

  for (let r = 1; r < rows.length; r++) {
    const get = (name: (typeof PRODUCT_CSV_HEADER)[number]) => (col(name) >= 0 ? (rows[r][col(name)] ?? "").replace(/^'(?=[=+\-@])/, "") : undefined);
    const sku = get("sku")?.trim() || "";
    const existingId = sku ? bySku.get(sku.toLowerCase()) : undefined;
    const sortRaw = get("sort_order")?.trim();

    const parsed = productSchema.safeParse({
      name: get("name") ?? "",
      price: get("price") ?? "",
      sku,
      category: get("category") ?? "",
      description: get("description") ?? "",
      published: parseBool(get("published"), true),
      sort_order: sortRaw || String(existingId ? (existing!.find((p) => p.id === existingId)?.sort_order ?? 0) : nextOrder),
    });
    if (!parsed.success) {
      problems.push(`Row ${r + 1}: ${firstError(parsed.error)}`);
      continue;
    }
    const { price, ...rest } = parsed.data;
    const row = { ...rest, price_cents: price };
    const { error, data } = existingId
      ? await supabase.from("products").update(row).eq("id", existingId).select("id").single()
      : await supabase.from("products").insert(row).select("id").single();
    if (error) {
      problems.push(`Row ${r + 1}: ${dbError(error.message)}`);
      continue;
    }
    if (existingId) updated++;
    else {
      created++;
      if (!sortRaw) nextOrder += 10;
      if (sku && data) bySku.set(sku.toLowerCase(), data.id);
    }
  }

  refresh();
  const summary = `Imported: ${created} added, ${updated} updated.`;
  if (problems.length) return { error: `${summary} ${problems.length} skipped — ${problems.slice(0, 5).join("; ")}${problems.length > 5 ? "…" : ""}` };
  return { ok: summary };
}
