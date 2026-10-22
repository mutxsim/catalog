import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { publicStorageUrl } from "@/lib/public-url";
import { getSettings } from "@/lib/settings";
import type { Product } from "@/lib/types";
import { btn, input } from "@/components/ui";
import { moveProduct, togglePublished } from "./actions";
import { CsvImport } from "./csv-import";

export const metadata: Metadata = { title: "Products" };
const PAGE_SIZE = 50;

export default async function ProductsPage({ searchParams }: PageProps<"/admin/products">) {
  const { supabase } = await requireAdmin();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const saved = typeof sp.saved === "string" ? sp.saved : null;
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const settings = await getSettings();

  let query = supabase
    .from("products")
    .select("id, name, price_cents, sku, category, image_path, published, sort_order", { count: "exact" })
    .order("sort_order")
    .order("name")
    .order("id")
    .range(offset, offset + PAGE_SIZE - 1);
  if (q) {
    const term = q.replace(/[%_,()]/g, " ");
    query = query.or(`name.ilike.%${term}%,sku.ilike.%${term}%,category.ilike.%${term}%`);
  }
  const { data, error, count } = await query;
  const products = (data ?? []) as Product[];
  const total = count ?? products.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const { data: flavorRows } = products.length
    ? await supabase.from("product_flavors").select("product_id").in("product_id", products.map((p) => p.id))
    : { data: [] };
  const pageLink = (n: number) => `/admin/products?${new URLSearchParams({ ...(q ? { q } : {}), page: String(n) })}`;
  const flavorCount = new Map<string, number>();
  for (const f of flavorRows ?? []) flavorCount.set(f.product_id, (flavorCount.get(f.product_id) ?? 0) + 1);
  const canReorder = !q;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Products</h1>
        <Link href="/admin/products/new" className={btn.primary}>Add product</Link>
      </div>

      {saved && <p className="mt-4 rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">Saved “{saved}”.</p>}
      {error && <p className="mt-4 text-sm text-danger">Could not load products.</p>}

      <form className="mt-5 flex gap-2" role="search">
        <input name="q" defaultValue={q} placeholder="Search name, SKU or category" className={`${input} max-w-sm`} />
        <button className={btn.secondary}>Search</button>
        {q && <Link href="/admin/products" className={btn.ghost}>Clear</Link>}
      </form>

      <div className="mt-5 overflow-x-auto rounded-xl border border-line bg-card">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
              <th className="w-16 px-4 py-3 font-medium">Order</th>
              <th className="px-2 py-3 font-medium">Product</th>
              <th className="px-2 py-3 font-medium">SKU</th>
              <th className="px-2 py-3 font-medium">Category</th>
              <th className="px-2 py-3 text-right font-medium">Price</th>
              <th className="px-2 py-3 font-medium">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {products.map((p, i) => {
              const img = publicStorageUrl("product-images", p.image_path);
              return (
                <tr key={p.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2">
                    {canReorder && (
                      <div className="flex gap-0.5">
                        <form action={moveProduct}>
                          <input type="hidden" name="id" value={p.id} />
                          <input type="hidden" name="dir" value="up" />
                          <button disabled={offset + i === 0} aria-label={`Move ${p.name} up`} className="h-7 w-7 rounded text-muted hover:bg-subtle hover:text-ink disabled:opacity-20">↑</button>
                        </form>
                        <form action={moveProduct}>
                          <input type="hidden" name="id" value={p.id} />
                          <input type="hidden" name="dir" value="down" />
                          <button disabled={offset + i === total - 1} aria-label={`Move ${p.name} down`} className="h-7 w-7 rounded text-muted hover:bg-subtle hover:text-ink disabled:opacity-20">↓</button>
                        </form>
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-3">
                      <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-subtle">
                        {img && <Image src={img} alt="" fill sizes="40px" className="object-cover" />}
                      </div>
                      <span>
                        <span className="font-medium">{p.name}</span>
                        {(flavorCount.get(p.id) ?? 0) > 0 && (
                          <span className="block text-xs text-muted">
                            {flavorCount.get(p.id)} flavor{flavorCount.get(p.id) === 1 ? "" : "s"}
                          </span>
                        )}
                      </span>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-muted">{p.sku ?? "—"}</td>
                  <td className="px-2 py-2 text-muted">{p.category ?? "—"}</td>
                  <td className="tabular px-2 py-2 text-right">{formatMoney(p.price_cents, settings.currency)}</td>
                  <td className="px-2 py-2">
                    <form action={togglePublished}>
                      <input type="hidden" name="id" value={p.id} />
                      <input type="hidden" name="published" value={String(!p.published)} />
                      <button
                        title={p.published ? "Click to hide" : "Click to publish"}
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${p.published ? "bg-accent-soft text-accent" : "bg-subtle text-muted"}`}
                      >
                        {p.published ? "Published" : "Hidden"}
                      </button>
                    </form>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link href={`/admin/products/${p.id}`} className={btn.small}>Edit</Link>
                  </td>
                </tr>
              );
            })}
            {products.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-muted">
                  {q ? "No products match your search." : "No products yet. Add your first product to start your catalog."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-muted">
          <span>{total} products · page {page} of {pages}</span>
          <div className="flex gap-2">
            {page > 1 && <Link href={pageLink(page - 1)} className={btn.small}>Previous</Link>}
            {page < pages && <Link href={pageLink(page + 1)} className={btn.small}>Next</Link>}
          </div>
        </div>
      )}

      <details className="mt-8 rounded-xl border border-line bg-card">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Import / export CSV</summary>
        <div className="border-t border-line px-4 py-4 text-sm">
          <p className="text-muted">
            Columns: <code className="font-mono text-xs">name, price, sku, category, flavors, description, published, sort_order</code>. List flavors separated by semicolons (e.g. <code className="font-mono text-xs">Mint; Grape; Mango</code>); a filled flavors cell replaces that product&apos;s flavor list. Rows with a
            SKU that already exists update that product; other rows are added. Images are managed per product.
          </p>
          <div className="mt-4 flex flex-wrap items-start gap-3">
            <a href="/admin/products/export" download className={btn.secondary}>Export CSV</a>
            <CsvImport />
          </div>
        </div>
      </details>
    </div>
  );
}
