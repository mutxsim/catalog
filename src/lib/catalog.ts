import "server-only";
import { createPublicClient } from "@/lib/supabase/server";
import type { Flavor, Product, ProductWithFlavors } from "@/lib/types";

export const PRODUCT_COLUMNS = "id, name, price_cents, sku, description, category, image_path, published, sort_order";
export const FLAVOR_COLUMNS = "id, product_id, name, image_path, sort_order";

/** Attach each product's flavors (in display order). */
export async function withFlavors(products: Product[]): Promise<ProductWithFlavors[]> {
  if (products.length === 0) return [];
  const { data, error } = await createPublicClient()
    .from("product_flavors")
    .select(FLAVOR_COLUMNS)
    .in("product_id", products.map((p) => p.id))
    .order("sort_order")
    .order("name");
  if (error) throw new Error(`Could not load flavors: ${error.message}`);
  const byProduct = new Map<string, Flavor[]>();
  for (const f of (data ?? []) as Flavor[]) {
    const list = byProduct.get(f.product_id) ?? [];
    list.push(f);
    byProduct.set(f.product_id, list);
  }
  return products.map((p) => ({ ...p, flavors: byProduct.get(p.id) ?? [] }));
}

/** IDs of published products with a flavor whose name matches the search. */
export async function productIdsWithFlavor(term: string): Promise<{ productId: string; flavorId: string }[]> {
  const { data } = await createPublicClient().from("product_flavors").select("id, product_id").ilike("name", `%${term}%`).limit(500);
  return ((data ?? []) as { id: string; product_id: string }[]).map((r) => ({ productId: r.product_id, flavorId: r.id }));
}
