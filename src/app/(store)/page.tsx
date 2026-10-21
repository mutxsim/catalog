import Link from "next/link";
import { createPublicClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";
import type { Product } from "@/lib/types";
import { ProductCard } from "@/components/store/product-card";

export default async function CatalogPage({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  const category = typeof sp.c === "string" ? sp.c : "";
  const settings = await getSettings();
  const db = createPublicClient();

  let query = db
    .from("products")
    .select("id, name, price_cents, sku, description, category, image_path, published, sort_order")
    .eq("published", true)
    .order("sort_order")
    .order("name");
  if (category) query = query.eq("category", category);
  if (q) {
    const term = q.replace(/[%_,()]/g, " ");
    query = query.or(`name.ilike.%${term}%,sku.ilike.%${term}%,description.ilike.%${term}%`);
  }

  const [{ data, error }, { data: cats }] = await Promise.all([
    query,
    db.from("products").select("category").eq("published", true).not("category", "is", null),
  ]);
  const products = (data ?? []) as Product[];
  const categories = [...new Set((cats ?? []).map((r) => r.category as string))].sort((a, b) => a.localeCompare(b));

  const chip = (active: boolean) =>
    `shrink-0 rounded-full px-3.5 h-8 text-sm leading-8 transition-colors ${active ? "bg-ink text-white" : "border border-line bg-card text-ink hover:border-ink/40"}`;
  const href = (c: string) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (c) p.set("c", c);
    const s = p.toString();
    return s ? `/?${s}` : "/";
  };

  return (
    <main className="mx-auto max-w-6xl px-4 pb-8 pt-5 sm:px-6 sm:pt-8">
      {categories.length > 0 && (
        <nav aria-label="Categories" className="-mx-4 mb-6 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          <Link href={href("")} className={chip(!category)} scroll={false}>All</Link>
          {categories.map((c) => (
            <Link key={c} href={href(c)} className={chip(category === c)} scroll={false}>{c}</Link>
          ))}
        </nav>
      )}

      {q && (
        <p className="mb-4 text-sm text-muted">
          {products.length} result{products.length === 1 ? "" : "s"} for “{q}”
        </p>
      )}

      {error ? (
        <p className="py-20 text-center text-muted">The catalog couldn&apos;t be loaded. Please refresh.</p>
      ) : products.length === 0 ? (
        <p className="py-20 text-center text-muted">{q || category ? "No products match." : "No products available yet."}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5 md:grid-cols-3 lg:grid-cols-4">
          {products.map((p, i) => (
            <li key={p.id}>
              <ProductCard product={p} currency={settings.currency} priority={i < 4} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
