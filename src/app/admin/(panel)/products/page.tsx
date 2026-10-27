import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { publicStorageUrl } from "@/lib/public-url";
import { getSettings } from "@/lib/settings";
import { CATALOGS, CATALOG_LABEL, isCatalog, type Product } from "@/lib/types";
import { btn, input } from "@/components/ui";
import { moveProduct, toggleInStock, togglePublished } from "./actions";
import { CsvImport } from "./csv-import";

export const metadata: Metadata = { title: "Products" };
// CSV imports with image links download pictures; allow the action time to run.
export const maxDuration = 300;
const PAGE_SIZE = 50;

export default async function ProductsPage({ searchParams }: PageProps<"/admin/products">) {
  const { supabase } = await requireAdmin();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const saved = typeof sp.saved === "string" ? sp.saved : null;
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1);
  // Catalog tab: "happy" (default), "vapes", or "all".
  const tab = sp.catalog === "all" ? "all" : isCatalog(sp.catalog) ? sp.catalog : "happy";
  const offset = (page - 1) * PAGE_SIZE;
  const settings = await getSettings();

  let query = supabase
    .from("products")
    .select("id, name, price_cents, sku, category, catalog, brand, image_path, published, in_stock, sort_order", { count: "exact" })
    .order("catalog")
    .order("sort_order")
    .order("name")
    .order("id")
    .range(offset, offset + PAGE_SIZE - 1);
  if (tab !== "all") query = query.eq("catalog", tab);
  if (q) {
    const term = q.replace(/[%_,()]/g, " ");
    query = query.or(`name.ilike.%${term}%,sku.ilike.%${term}%,category.ilike.%${term}%,brand.ilike.%${term}%`);
  }
  const countIn = (c: string) => supabase.from("products").select("id", { count: "exact", head: true }).eq("catalog", c);
  const [{ data, error, count }, ...tabCounts] = await Promise.all([query, ...CATALOGS.map(countIn)]);
  const products = (data ?? []) as Product[];
  const total = count ?? products.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const { data: flavorRows } = products.length
    ? await supabase.from("product_flavors").select("product_id, in_stock").in("product_id", products.map((p) => p.id))
    : { data: [] };
  const pageLink = (n: number) => `/admin/products?${new URLSearchParams({ ...(tab !== "happy" ? { catalog: tab } : {}), ...(q ? { q } : {}), page: String(n) })}`;
  const tabLink = (t: string) => `/admin/products${t === "happy" ? "" : `?catalog=${t}`}`;
  const tabs = [...CATALOGS.map((c, i) => ({ key: c as string, label: CATALOG_LABEL[c], n: tabCounts[i].count ?? 0 })), { key: "all", label: "All", n: null as number | null }];
  const flavorCount = new Map<string, number>();
  const flavorsOut = new Map<string, number>();
  for (const f of flavorRows ?? []) {
    flavorCount.set(f.product_id, (flavorCount.get(f.product_id) ?? 0) + 1);
    if (f.in_stock === false) flavorsOut.set(f.product_id, (flavorsOut.get(f.product_id) ?? 0) + 1);
  }
  // Arrows move a product within its own catalog, so they're shown per catalog tab.
  const canReorder = !q && tab !== "all";

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Products</h1>
        <Link href={`/admin/products/new${tab === "vapes" ? "?catalog=vapes" : ""}`} className={btn.primary}>Add product</Link>
      </div>

      {saved && <p className="mt-4 rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">Saved “{saved}”.</p>}
      {error && <p className="mt-4 text-sm text-danger">Could not load products.</p>}

      <nav aria-label="Catalogs" className="mt-5 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={tabLink(t.key)}
            aria-current={tab === t.key ? "page" : undefined}
            className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-4 text-sm font-medium ${tab === t.key ? "border-accent bg-accent-soft text-accent" : "border-line bg-card text-muted hover:text-ink"}`}
          >
            {t.label}
            {t.n !== null && <span className="tabular text-xs opacity-70">{t.n}</span>}
          </Link>
        ))}
      </nav>

      <form className="mt-4 flex gap-2" role="search">
        {tab !== "happy" && <input type="hidden" name="catalog" value={tab} />}
        <input name="q" defaultValue={q} placeholder="Search name, SKU, brand or category" className={`${input} max-w-sm`} />
        <button className={btn.secondary}>Search</button>
        {q && <Link href={tabLink(tab)} className={btn.ghost}>Clear</Link>}
      </form>

      <div className="mt-5 overflow-x-auto rounded-xl border border-line bg-card">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
              <th className="w-16 px-4 py-3 font-medium">Order</th>
              <th className="px-2 py-3 font-medium">Product</th>
              <th className="px-2 py-3 font-medium">SKU</th>
              <th className="px-2 py-3 font-medium">Brand</th>
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
                            {(flavorsOut.get(p.id) ?? 0) > 0 && <span className="text-danger"> · {flavorsOut.get(p.id)} out of stock</span>}
                          </span>
                        )}
                      </span>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-muted">{p.sku ?? "—"}</td>
                  <td className="px-2 py-2 text-muted">{p.brand ?? "—"}</td>
                  <td className="px-2 py-2 text-muted">
                    {p.category ?? "—"}
                    {tab === "all" && <span className="block text-xs">{CATALOG_LABEL[p.catalog] ?? p.catalog}</span>}
                  </td>
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
                    <form action={toggleInStock} className="mt-1">
                      <input type="hidden" name="id" value={p.id} />
                      <input type="hidden" name="in_stock" value={String(!p.in_stock)} />
                      <button
                        title={p.in_stock ? "Click to mark out of stock" : "Click to mark in stock"}
                        className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${p.in_stock ? "bg-subtle text-muted" : "bg-subtle text-danger"}`}
                      >
                        {p.in_stock ? "In stock" : "Out of stock"}
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
                <td colSpan={8} className="px-4 py-12 text-center text-muted">
                  {q ? "No products match your search." : tab === "all" ? "No products yet. Add your first product to start your catalog." : `No products in ${CATALOG_LABEL[tab]} yet.`}
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
            Columns: <code className="font-mono text-xs">id, catalog, brand, name, price, sku, category, flavors, description, published, sort_order, image_url, in_stock</code>. <code className="font-mono text-xs">catalog</code> is <code className="font-mono text-xs">happy</code> or <code className="font-mono text-xs">vapes</code> (empty keeps the current catalog; new products go to Happy). List flavors separated by semicolons (e.g. <code className="font-mono text-xs">Mint; Grape; Mango</code>); a filled flavors cell replaces that product&apos;s flavor list. Rows whose
            <code className="font-mono text-xs">id</code> (from an export) or SKU matches an existing product update it; other rows are added. An <code className="font-mono text-xs">image_url</code> link is downloaded and becomes the product photo (large imports may need running twice to finish all images; links already imported are skipped). <code className="font-mono text-xs">in_stock</code> (true/false) sets stock when filled in; leave it empty to keep the current stock.
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
