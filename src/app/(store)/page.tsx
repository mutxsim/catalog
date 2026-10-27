import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCustomer } from "@/lib/customer-auth";
import { createPublicClient } from "@/lib/supabase/server";
import { CATALOGS, CATALOG_LABEL } from "@/lib/types";

const BLURB: Record<(typeof CATALOGS)[number], string> = {
  vapes: "Disposable vapes and more",
  happy: "Gummies, cartridges, pre-rolls, flower and more",
};

/** First screen after entering an access code: pick a catalog. */
export default async function ChooseCatalogPage({ searchParams }: PageProps<"/">) {
  await requireCustomer();
  const sp = await searchParams;
  // Old catalog links (/?q=…&c=…) predate the two catalogs; they meant Happy.
  if (["q", "c", "page"].some((k) => typeof sp[k] === "string")) {
    const p = new URLSearchParams();
    for (const k of ["q", "c", "page"]) if (typeof sp[k] === "string") p.set(k, sp[k] as string);
    redirect(`/shop/happy?${p}`);
  }

  const db = createPublicClient();
  const counts = await Promise.all(
    CATALOGS.map((c) => db.from("products").select("id", { count: "exact", head: true }).eq("published", true).eq("catalog", c)),
  );
  const tiles = (["vapes", "happy"] as const).map((c) => ({ c, n: counts[CATALOGS.indexOf(c)].count }));

  return (
    <main>
      <section className="store-hero border-b border-line">
        <div className="mx-auto max-w-6xl px-4 py-10 text-center sm:px-6 sm:py-14">
          <h1 className="text-2xl font-extrabold uppercase tracking-[0.35em] text-highlight sm:text-4xl">Catalog</h1>
          <p className="mt-3 text-sm text-muted">Choose where to shop</p>
        </div>
      </section>

      <div className="mx-auto grid max-w-4xl gap-5 px-4 py-8 sm:grid-cols-2 sm:px-6 sm:py-12">
        {tiles.map(({ c, n }) => (
          <Link
            key={c}
            href={`/shop/${c}`}
            className="group relative flex min-h-56 flex-col justify-between overflow-hidden rounded-3xl border border-line bg-card p-6 transition-colors hover:border-accent sm:min-h-72 sm:p-8"
          >
            <span
              aria-hidden
              className={`pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full blur-3xl transition-opacity group-hover:opacity-100 ${
                c === "vapes" ? "bg-[rgb(124_92_214/0.35)] opacity-70" : "bg-[rgb(143_227_160/0.22)] opacity-70"
              }`}
            />
            <span className="relative text-xs font-semibold uppercase tracking-[0.25em] text-muted">
              {n === null ? "" : n === 0 ? "Coming soon" : `${n} product${n === 1 ? "" : "s"}`}
            </span>
            <span className="relative">
              <span className="block text-4xl font-extrabold uppercase tracking-[0.2em] text-ink sm:text-5xl">{CATALOG_LABEL[c]}</span>
              <span className="mt-3 block text-sm text-muted">{BLURB[c]}</span>
              <span className="mt-6 inline-flex h-11 items-center rounded-xl bg-highlight px-5 text-sm font-bold text-paper transition-opacity group-hover:opacity-90">
                Shop {CATALOG_LABEL[c]} →
              </span>
            </span>
          </Link>
        ))}
      </div>
    </main>
  );
}
