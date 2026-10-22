import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { createPublicClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";
import { requireCustomer } from "@/lib/customer-auth";
import { PRODUCT_COLUMNS, withFlavors } from "@/lib/catalog";
import type { Product } from "@/lib/types";
import { ProductPanel } from "@/components/store/product-panel";

const getProduct = cache(async (id: string) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const { data } = await createPublicClient().from("products").select(PRODUCT_COLUMNS).eq("id", id).eq("published", true).maybeSingle();
  if (!data) return null;
  const [product] = await withFlavors([data as Product]);
  return product;
});

export async function generateMetadata({ params }: PageProps<"/p/[id]">): Promise<Metadata> {
  const p = await getProduct((await params).id);
  return { title: p?.name ?? "Product" };
}

export default async function ProductPage({ params, searchParams }: PageProps<"/p/[id]">) {
  await requireCustomer();
  const product = await getProduct((await params).id);
  if (!product) notFound();
  const settings = await getSettings();
  const f = (await searchParams).flavor;

  return (
    <main className="mx-auto max-w-5xl px-4 pb-10 pt-4 sm:px-6 sm:pt-8">
      <Link href="/" className="inline-flex h-9 items-center text-sm text-muted hover:text-ink">← Back to catalog</Link>
      <div className="mt-3">
        <ProductPanel layout="detail" product={product} currency={settings.currency} initialFlavorId={typeof f === "string" ? f : undefined} priority />
      </div>
    </main>
  );
}
