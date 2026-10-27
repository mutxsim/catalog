import "server-only";
import Link from "next/link";
import { createPublicClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";
import { CATALOG_PAGE_SIZE, PRODUCT_COLUMNS, productIdsWithFlavor, publishedFacets, withFlavors } from "@/lib/catalog";
import { CATALOG_LABEL, type Catalog, type Product } from "@/lib/types";
import { waMeLink } from "@/lib/whatsapp/message";
import { ProductPanel } from "@/components/store/product-panel";
import { CatalogSearch } from "@/components/store/catalog-search";

type SearchParams = Record<string, string | string[] | undefined>;

const text = (v: string | string[] | undefined, max = 100) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** URL for a catalog (or the all-catalog search) with the given filters. */
export function catalogHref(basePath: string, f: { q?: string; brand?: string; category?: string; page?: number }) {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.brand) p.set("b", f.brand);
  if (f.category) p.set("c", f.category);
  if (f.page && f.page > 1) p.set("page", String(f.page));
  const s = p.toString();
  return s ? `${basePath}?${s}` : basePath;
}

/**
 * Product grid with brand + category filters, search and pages. `catalog`
 * null searches every catalog (used by the header search on other pages).
 */
export async function CatalogView({ catalog, searchParams }: { catalog: Catalog | null; searchParams: SearchParams }) {
  const q = text(searchParams.q);
  const brand = text(searchParams.b, 80);
  const category = text(searchParams.c, 80);
  const page = Math.max(1, Math.floor(Number(searchParams.page)) || 1);
  const basePath = catalog ? `/shop/${catalog}` : "/search";
  const settings = await getSettings();
  const db = createPublicClient();

  // Search matches product fields and flavor names.
  const term = q.replace(/[%_,()"]/g, " ").trim();
  const flavorHits = term ? await productIdsWithFlavor(term) : [];

  let query = db
    .from("products")
    .select(PRODUCT_COLUMNS, { count: "exact" })
    .eq("published", true)
    .order("sort_order")
    .order("name")
    .order("id")
    .range((page - 1) * CATALOG_PAGE_SIZE, page * CATALOG_PAGE_SIZE - 1);
  if (catalog) query = query.eq("catalog", catalog);
  if (brand) query = query.eq("brand", brand);
  if (category) query = query.eq("category", category);
  if (term) {
    const ids = [...new Set(flavorHits.map((h) => h.productId))];
    query = query.or(
      [`name.ilike.%${term}%`, `sku.ilike.%${term}%`, `brand.ilike.%${term}%`, `description.ilike.%${term}%`, ...(ids.length ? [`id.in.(${ids.join(",")})`] : [])].join(","),
    );
  }

  const [{ data, error, count }, facets] = await Promise.all([query, publishedFacets(catalog)]);
  const products = await withFlavors((data ?? []) as Product[]);
  const total = count ?? products.length;
  const pages = Math.max(1, Math.ceil(total / CATALOG_PAGE_SIZE));
  const pageHref = (n: number) => catalogHref(basePath, { q, brand, category, page: n });
  const whatsapp = waMeLink(settings.whatsapp_number, "Hi, I have a question about your catalog.");
  const title = catalog ? CATALOG_LABEL[catalog] : "Search";
  const filters = [brand, category].filter(Boolean).join(" · ");

  // When a search matches exactly one flavor of a product, preselect it.
  const preselect = new Map<string, string>();
  for (const p of products) {
    const hits = flavorHits.filter((h) => h.productId === p.id);
    if (hits.length === 1) preselect.set(p.id, hits[0].flavorId);
  }

  return (
    <main>
      <section className="store-hero border-b border-line">
        <div className="mx-auto max-w-6xl px-4 py-10 text-center sm:px-6 sm:py-14">
          <h1 className="text-2xl font-extrabold uppercase tracking-[0.35em] text-highlight sm:text-4xl">{title}</h1>
          {!catalog && <p className="mt-3 text-sm text-muted">Searching every catalog</p>}
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 pb-8 pt-6 sm:px-6 sm:pt-8">
        {whatsapp && (
          <div className="mb-6 flex flex-col items-center gap-3 rounded-3xl border border-line bg-card px-5 py-5 text-center sm:flex-row sm:justify-between sm:text-left">
            <p className="text-[15px] font-semibold">Questions? Message us on WhatsApp</p>
            <a
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center justify-center rounded-xl bg-highlight px-5 text-sm font-bold text-paper transition-opacity hover:opacity-90"
            >
              Message us on WhatsApp
            </a>
          </div>
        )}

        <CatalogSearch
          basePath={basePath}
          query={q}
          brand={brand}
          category={category}
          brands={facets.brands}
          categories={facets.categories}
        />

        <p className="mb-5 mt-6 text-sm text-muted">
          {q
            ? `${total} result${total === 1 ? "" : "s"} for “${q}”${filters ? ` · ${filters}` : ""}`
            : `${total} product${total === 1 ? "" : "s"}${filters ? ` · ${filters}` : ""}`}
          {pages > 1 && ` · page ${page} of ${pages}`}
        </p>

        {error ? (
          <p className="py-20 text-center text-muted">The catalog couldn&apos;t be loaded. Please refresh.</p>
        ) : products.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-line px-4 py-20 text-center text-muted">
            <p>{q || brand || category ? "No products match." : "No products here yet — check back soon."}</p>
            {(q || brand || category) && (
              <Link href={basePath} className="mt-4 inline-block text-sm text-ink underline underline-offset-4">Clear filters</Link>
            )}
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((p, i) => (
              <li key={p.id}>
                <ProductPanel layout="card" product={p} currency={settings.currency} initialFlavorId={preselect.get(p.id)} priority={i < 2} />
              </li>
            ))}
          </ul>
        )}

        {pages > 1 && (
          <nav aria-label="Pages" className="mt-8 flex items-center justify-center gap-3">
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className="inline-flex h-11 items-center rounded-xl border border-line bg-card px-4 text-sm font-medium hover:border-accent">
                ← Previous
              </Link>
            ) : (
              <span className="inline-flex h-11 items-center rounded-xl border border-line px-4 text-sm text-muted opacity-40">← Previous</span>
            )}
            <span className="tabular text-sm text-muted">{page} / {pages}</span>
            {page < pages ? (
              <Link href={pageHref(page + 1)} className="inline-flex h-11 items-center rounded-xl border border-line bg-card px-4 text-sm font-medium hover:border-accent">
                Next →
              </Link>
            ) : (
              <span className="inline-flex h-11 items-center rounded-xl border border-line px-4 text-sm text-muted opacity-40">Next →</span>
            )}
          </nav>
        )}

      </div>
    </main>
  );
}
