import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { createPublicClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";
import { groupProducts } from "@/lib/catalog";
import type { Product } from "@/lib/types";
import { ProductPanel } from "@/components/store/product-panel";

const COLUMNS = "id, name, price_cents, sku, description, category, image_path, published, sort_order, group_name, variant_name";

/** The product plus the other published flavors in its group. */
const getProductGroup = cache(async (id: string) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const db = createPublicClient();
  const { data } = await db.from("products").select(COLUMNS).eq("id", id).eq("published", true).maybeSingle();
  const product = data as Product | null;
  if (!product) return null;
  let variants = [product];
  if (product.group_name) {
    const { data: siblings } = await db.from("products").select(COLUMNS).eq("published", true).eq("group_name", product.group_name);
    if (siblings?.length) variants = siblings as Product[];
  }
  const [entry] = groupProducts(variants);
  return { product, entry };
});

export async function generateMetadata({ params }: PageProps<"/p/[id]">): Promise<Metadata> {
  const g = await getProductGroup((await params).id);
  return { title: g?.entry.title ?? "Product" };
}

export default async function ProductPage({ params }: PageProps<"/p/[id]">) {
  const g = await getProductGroup((await params).id);
  if (!g) notFound();
  const settings = await getSettings();

  return (
    <main className="mx-auto max-w-5xl px-4 pb-10 pt-4 sm:px-6 sm:pt-8">
      <Link href="/" className="inline-flex h-9 items-center text-sm text-muted hover:text-ink">← Back to catalog</Link>
      <div className="mt-3">
        <ProductPanel
          layout="detail"
          title={g.entry.title}
          category={g.entry.category}
          variants={g.entry.variants}
          currency={settings.currency}
          initialId={g.product.id}
          priority
        />
      </div>
    </main>
  );
}
