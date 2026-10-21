import type { Product } from "@/lib/types";

/** One catalog card: a single product, or a group of flavors of the same product. */
export type CatalogEntry = {
  key: string;
  title: string;
  category: string | null;
  sortOrder: number;
  variants: Product[];
};

export const groupKey = (p: Pick<Product, "id" | "group_name">) =>
  p.group_name?.trim() ? `g:${p.group_name.trim().toLowerCase()}` : `p:${p.id}`;

/** Label shown on a flavor option. */
export const variantLabel = (p: Pick<Product, "name" | "variant_name">) => p.variant_name?.trim() || p.name;

/** Name used in the cart, on invoices and in WhatsApp (mirrors quote_items in SQL). */
export function lineName(p: Pick<Product, "name" | "variant_name">) {
  const v = p.variant_name?.trim();
  return v && !p.name.toLowerCase().includes(v.toLowerCase()) ? `${p.name} — ${v}` : p.name;
}

/** Collapse products that share a group into one entry, keeping catalog order. */
export function groupProducts(products: Product[]): CatalogEntry[] {
  const map = new Map<string, CatalogEntry>();
  for (const p of products) {
    const key = groupKey(p);
    const entry = map.get(key);
    if (entry) {
      entry.variants.push(p);
      entry.sortOrder = Math.min(entry.sortOrder, p.sort_order);
      entry.category ??= p.category;
    } else {
      map.set(key, { key, title: p.group_name?.trim() || p.name, category: p.category, sortOrder: p.sort_order, variants: [p] });
    }
  }
  const entries = [...map.values()];
  for (const e of entries) e.variants.sort((a, b) => a.sort_order - b.sort_order || variantLabel(a).localeCompare(variantLabel(b)));
  return entries.sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
}
