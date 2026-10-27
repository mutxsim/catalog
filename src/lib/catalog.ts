import "server-only";
import { createPublicClient } from "@/lib/supabase/server";
import { fetchAll, inChunks } from "@/lib/fetch-all";
import type { Catalog, Flavor, Product, ProductWithFlavors } from "@/lib/types";

export const PRODUCT_COLUMNS = "id, name, price_cents, sku, description, category, catalog, brand, image_path, published, in_stock, sort_order";
export const FLAVOR_COLUMNS = "id, product_id, name, image_path, in_stock, sort_order";
export const CATALOG_PAGE_SIZE = 48;

/** Attach each product's flavors (in display order). Looks them up in small batches. */
export async function withFlavors(products: Product[]): Promise<ProductWithFlavors[]> {
  if (products.length === 0) return [];
  const db = createPublicClient();
  const rows = await inChunks<Flavor>(products.map((p) => p.id), (chunk) =>
    db.from("product_flavors").select(FLAVOR_COLUMNS).in("product_id", chunk).order("sort_order").order("name"),
  );
  const byProduct = new Map<string, Flavor[]>();
  for (const f of rows) {
    const list = byProduct.get(f.product_id) ?? [];
    list.push(f);
    byProduct.set(f.product_id, list);
  }
  return products.map((p) => ({ ...p, flavors: byProduct.get(p.id) ?? [] }));
}

/** Published products with a flavor whose name matches the search (capped to keep the query short). */
export async function productIdsWithFlavor(term: string): Promise<{ productId: string; flavorId: string }[]> {
  const { data } = await createPublicClient().from("product_flavors").select("id, product_id").ilike("name", `%${term}%`).limit(100);
  return ((data ?? []) as { id: string; product_id: string }[]).map((r) => ({ productId: r.product_id, flavorId: r.id }));
}

const sortNames = (names: (string | null)[]) =>
  [...new Set(names.filter((n): n is string => !!n))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

/** Distinct brands and categories of published products in a catalog (or in every catalog). */
export async function publishedFacets(catalog: Catalog | null): Promise<{ brands: string[]; categories: string[] }> {
  const db = createPublicClient();
  const rows = await fetchAll<{ brand: string | null; category: string | null }>((from, to) => {
    let q = db.from("products").select("brand, category").eq("published", true);
    if (catalog) q = q.eq("catalog", catalog);
    return q.order("id").range(from, to);
  });
  return { brands: sortNames(rows.map((r) => r.brand)), categories: sortNames(rows.map((r) => r.category)) };
}
