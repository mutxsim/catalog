import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { createPublicClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/money";
import { publicStorageUrl } from "@/lib/public-url";
import { getSettings } from "@/lib/settings";
import type { Product } from "@/lib/types";
import { AddToCart } from "@/components/store/add-to-cart";

const getProduct = cache(async (id: string) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const { data } = await createPublicClient()
    .from("products")
    .select("id, name, price_cents, sku, description, category, image_path, published, sort_order")
    .eq("id", id)
    .eq("published", true)
    .maybeSingle();
  return data as Product | null;
});

export async function generateMetadata({ params }: PageProps<"/p/[id]">): Promise<Metadata> {
  const p = await getProduct((await params).id);
  return { title: p?.name ?? "Product" };
}

export default async function ProductPage({ params }: PageProps<"/p/[id]">) {
  const product = await getProduct((await params).id);
  if (!product) notFound();
  const settings = await getSettings();
  const img = publicStorageUrl("product-images", product.image_path);

  return (
    <main className="mx-auto max-w-5xl px-4 pb-10 pt-4 sm:px-6 sm:pt-8">
      <Link href="/" className="inline-flex h-9 items-center text-sm text-muted hover:text-ink">← Back to catalog</Link>
      <div className="mt-3 grid gap-8 md:grid-cols-2 md:gap-12">
        <div className="relative aspect-square overflow-hidden rounded-2xl bg-subtle">
          {img ? (
            <Image src={img} alt={product.name} fill priority sizes="(min-width: 768px) 480px, 100vw" className="object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted">No image</div>
          )}
        </div>
        <div className="md:pt-2">
          {product.category && <p className="text-xs font-medium uppercase tracking-wide text-muted">{product.category}</p>}
          <h1 className="mt-1 text-2xl font-semibold leading-tight tracking-tight">{product.name}</h1>
          {product.sku && <p className="mt-1 text-sm text-muted">SKU {product.sku}</p>}
          <p className="tabular mt-4 text-xl">{formatMoney(product.price_cents, settings.currency)}</p>
          <div className="mt-6">
            <AddToCart item={{ productId: product.id, name: product.name, priceCents: product.price_cents, sku: product.sku, imagePath: product.image_path }} />
          </div>
          {product.description && <p className="mt-8 whitespace-pre-line text-[15px] leading-relaxed text-ink/80">{product.description}</p>}
        </div>
      </div>
    </main>
  );
}
