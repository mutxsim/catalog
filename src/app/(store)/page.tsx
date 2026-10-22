import { createPublicClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";
import { requireCustomer } from "@/lib/customer-auth";
import { PRODUCT_COLUMNS, productIdsWithFlavor, withFlavors } from "@/lib/catalog";
import type { Product } from "@/lib/types";
import { waMeLink } from "@/lib/whatsapp/message";
import { ProductPanel } from "@/components/store/product-panel";
import { CatalogSearch } from "@/components/store/catalog-search";

export default async function CatalogPage({ searchParams }: PageProps<"/">) {
  await requireCustomer();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  const category = typeof sp.c === "string" ? sp.c : "";
  const settings = await getSettings();
  const db = createPublicClient();

  // Search matches product fields and flavor names.
  const term = q.replace(/[%_,()"]/g, " ").trim();
  const flavorHits = term ? await productIdsWithFlavor(term) : [];

  let query = db.from("products").select(PRODUCT_COLUMNS).eq("published", true).order("sort_order").order("name");
  if (category) query = query.eq("category", category);
  if (term) {
    const ids = [...new Set(flavorHits.map((h) => h.productId))];
    query = query.or(
      [`name.ilike.%${term}%`, `sku.ilike.%${term}%`, `description.ilike.%${term}%`, ...(ids.length ? [`id.in.(${ids.join(",")})`] : [])].join(","),
    );
  }

  const [{ data, error }, { data: cats }] = await Promise.all([
    query,
    db.from("products").select("category").eq("published", true).not("category", "is", null),
  ]);
  const products = await withFlavors((data ?? []) as Product[]);
  const categories = [...new Set((cats ?? []).map((r) => r.category as string))].sort((a, b) => a.localeCompare(b));
  const whatsapp = waMeLink(settings.whatsapp_number, "Hi, I have a question about your catalog.");

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
          <h1 className="text-2xl font-extrabold uppercase tracking-[0.35em] text-highlight sm:text-4xl">Catalog</h1>
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

        <CatalogSearch query={q} category={category} categories={categories} />

        <p className="mb-5 mt-6 text-sm text-muted">
          {q
            ? `${products.length} result${products.length === 1 ? "" : "s"} for “${q}”`
            : `${products.length} product${products.length === 1 ? "" : "s"}${category ? ` · ${category}` : ""}`}
        </p>

        {error ? (
          <p className="py-20 text-center text-muted">The catalog couldn&apos;t be loaded. Please refresh.</p>
        ) : products.length === 0 ? (
          <p className="rounded-3xl border border-dashed border-line py-20 text-center text-muted">
            {q || category ? "No products match." : "No products available yet."}
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((p, i) => (
              <li key={p.id}>
                <ProductPanel layout="card" product={p} currency={settings.currency} initialFlavorId={preselect.get(p.id)} priority={i < 2} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
