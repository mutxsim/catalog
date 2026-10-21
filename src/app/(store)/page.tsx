import { createPublicClient } from "@/lib/supabase/server";
import { displayName, getSettings } from "@/lib/settings";
import { groupProducts } from "@/lib/catalog";
import type { Product } from "@/lib/types";
import { waMeLink } from "@/lib/whatsapp/message";
import { ProductPanel } from "@/components/store/product-panel";
import { CatalogSearch } from "@/components/store/catalog-search";

const COLUMNS = "id, name, price_cents, sku, description, category, image_path, published, sort_order, group_name, variant_name";

export default async function CatalogPage({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  const category = typeof sp.c === "string" ? sp.c : "";
  const settings = await getSettings();
  const db = createPublicClient();

  let query = db.from("products").select(COLUMNS).eq("published", true).order("sort_order").order("name");
  if (category) query = query.eq("category", category);
  if (q) {
    const term = q.replace(/[%_,()]/g, " ");
    query = query.or(
      `name.ilike.%${term}%,sku.ilike.%${term}%,description.ilike.%${term}%,group_name.ilike.%${term}%,variant_name.ilike.%${term}%`,
    );
  }

  const [{ data, error }, { data: cats }] = await Promise.all([
    query,
    db.from("products").select("category").eq("published", true).not("category", "is", null),
  ]);
  let products = (data ?? []) as Product[];
  const matched = new Set(products.map((p) => p.id));

  // A search that matches one flavor still shows its whole product group,
  // with the matching flavor selected.
  if (q && products.some((p) => p.group_name)) {
    const groups = [...new Set(products.map((p) => p.group_name).filter((g): g is string => Boolean(g)))];
    let siblings = db.from("products").select(COLUMNS).eq("published", true).in("group_name", groups);
    if (category) siblings = siblings.eq("category", category);
    const { data: more } = await siblings;
    const seen = new Set(products.map((p) => p.id));
    products = [...products, ...((more ?? []) as Product[]).filter((p) => !seen.has(p.id))];
  }

  const entries = groupProducts(products);
  const categories = [...new Set((cats ?? []).map((r) => r.category as string))].sort((a, b) => a.localeCompare(b));
  const whatsapp = waMeLink(settings.whatsapp_number, "Hi, I have a question about your catalog.");
  const name = displayName(settings);

  return (
    <main>
      <section className="store-hero border-b border-line">
        <div className="mx-auto max-w-6xl px-4 pb-10 pt-10 text-center sm:px-6 sm:pb-14 sm:pt-14">
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-5xl">{name}</h1>
          <p className="mt-4 text-sm font-bold uppercase tracking-[0.4em] text-highlight sm:text-base">Catalog</p>
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
            ? `${entries.length} result${entries.length === 1 ? "" : "s"} for “${q}”`
            : `${entries.length} product${entries.length === 1 ? "" : "s"}${category ? ` · ${category}` : ""}`}
        </p>

        {error ? (
          <p className="py-20 text-center text-muted">The catalog couldn&apos;t be loaded. Please refresh.</p>
        ) : entries.length === 0 ? (
          <p className="rounded-3xl border border-dashed border-line py-20 text-center text-muted">
            {q || category ? "No products match." : "No products available yet."}
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {entries.map((e, i) => (
              <li key={e.key}>
                <ProductPanel
                  layout="card"
                  title={e.title}
                  category={e.category}
                  variants={e.variants}
                  currency={settings.currency}
                  initialId={q ? e.variants.find((v) => matched.has(v.id))?.id : undefined}
                  priority={i < 2}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
