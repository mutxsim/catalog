import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { MAX_PRODUCT_IMAGE_BYTES, readUpload } from "@/lib/uploads";
import { flavorNameSchema } from "@/lib/validation";

export const flavorRowsSchema = z
  .array(
    z.object({
      key: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
      id: z.uuid().nullable(),
      name: flavorNameSchema,
      removeImage: z.boolean().optional(),
    }),
  )
  .max(300, "Up to 300 flavors per product.");

export type FlavorInput = z.infer<typeof flavorRowsSchema>[number];

/** Parse and validate the editor payload. Returns an error message or rows. */
export function parseFlavorPayload(raw: FormDataEntryValue | null): { rows: FlavorInput[] } | { error: string } | null {
  if (raw === null || raw === "") return null; // field not on the form → leave flavors alone
  let json: unknown;
  try {
    json = JSON.parse(String(raw));
  } catch {
    return { error: "Couldn't read the flavor list. Please try again." };
  }
  const parsed = flavorRowsSchema.safeParse(json);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the flavor list." };
  const seen = new Set<string>();
  for (const r of parsed.data) {
    const k = r.name.trim().toLowerCase();
    if (seen.has(k)) return { error: `The flavor “${r.name.trim()}” is listed twice.` };
    seen.add(k);
  }
  return { rows: parsed.data };
}

/**
 * Delete storage images that no order line refers to. Images used on past
 * orders are kept so historical invoices can always be re-rendered.
 */
export async function removeUnreferencedImages(paths: (string | null | undefined)[]) {
  const unique = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  if (!unique.length) return;
  const db = createServiceClient();
  const { data } = await db.from("order_items").select("image_path").in("image_path", unique);
  const used = new Set((data ?? []).map((r) => r.image_path as string));
  const free = unique.filter((p) => !used.has(p));
  if (free.length) await db.storage.from("product-images").remove(free);
}

/**
 * Make the product's flavors match `rows` (in order): rename/reorder existing,
 * add new, delete removed, and apply per-flavor image uploads.
 */
export async function syncFlavors(productId: string, rows: FlavorInput[], formData?: FormData): Promise<{ error?: string }> {
  const db = createServiceClient();
  const storage = db.storage.from("product-images");

  // Validate uploads before writing anything.
  const uploads = new Map<string, { bytes: Uint8Array; ext: string; mime: string }>();
  for (const r of rows) {
    const up = await readUpload(formData?.get(`flavor_image_${r.key}`) ?? null, MAX_PRODUCT_IMAGE_BYTES, ["image/jpeg", "image/png", "image/webp"]);
    if (up && "error" in up) return { error: `${r.name.trim()}: ${up.error}` };
    if (up) uploads.set(r.key, { bytes: up.bytes, ext: up.kind.ext, mime: up.kind.mime });
  }

  const { data: current, error: loadError } = await db.from("product_flavors").select("id, name, image_path").eq("product_id", productId);
  if (loadError) return { error: "Couldn't load the existing flavors." };
  const existing = new Map((current ?? []).map((f) => [f.id as string, f as { id: string; name: string; image_path: string | null }]));
  const keepIds = new Set(rows.map((r) => r.id).filter((id): id is string => Boolean(id && existing.has(id))));
  const orphanedImages: (string | null)[] = [];

  // 1. Remove flavors no longer listed (past orders keep their snapshot).
  const removed = [...existing.values()].filter((f) => !keepIds.has(f.id));
  if (removed.length) {
    const { error } = await db.from("product_flavors").delete().in("id", removed.map((f) => f.id));
    if (error) return { error: "Couldn't remove flavors." };
    orphanedImages.push(...removed.map((f) => f.image_path));
  }

  // 2. Park renamed flavors under temporary names so swaps don't collide.
  const renamed = rows.filter((r) => r.id && keepIds.has(r.id) && existing.get(r.id)!.name !== r.name.trim());
  for (const r of renamed) await db.from("product_flavors").update({ name: `~${r.id}` }).eq("id", r.id!);

  // 3. Upsert in order.
  for (const [i, r] of rows.entries()) {
    const up = uploads.get(r.key);
    let imagePath: string | null | undefined;
    if (up) {
      imagePath = `products/${productId}/flavors/${randomUUID()}.${up.ext}`;
      const { error } = await storage.upload(imagePath, up.bytes, { contentType: up.mime, cacheControl: "31536000", upsert: false });
      if (error) return { error: `Image upload failed for ${r.name.trim()}.` };
    } else if (r.removeImage) {
      imagePath = null;
    }

    const fields = { name: r.name.trim(), sort_order: (i + 1) * 10, ...(imagePath !== undefined ? { image_path: imagePath } : {}) };
    if (r.id && keepIds.has(r.id)) {
      const before = existing.get(r.id)!;
      const { error } = await db.from("product_flavors").update(fields).eq("id", r.id);
      if (error) return { error: /duplicate|name_key/.test(error.message) ? `The flavor “${r.name.trim()}” already exists.` : "Couldn't save flavors." };
      if (imagePath !== undefined && before.image_path && before.image_path !== imagePath) orphanedImages.push(before.image_path);
    } else {
      const { error } = await db.from("product_flavors").insert({ product_id: productId, ...fields });
      if (error) return { error: /duplicate|name_key/.test(error.message) ? `The flavor “${r.name.trim()}” already exists.` : "Couldn't save flavors." };
    }
  }

  await removeUnreferencedImages(orphanedImages);
  return {};
}
