"use client";

import Image from "next/image";
import Link from "next/link";
import { useId, useState } from "react";
import { formatMoney } from "@/lib/money";
import { publicStorageUrl } from "@/lib/public-url";
import type { ProductWithFlavors } from "@/lib/types";
import { AddToCart } from "./add-to-cart";

/**
 * A product card (grid) or full product view (detail page). Products with
 * flavors get a "Flavor" dropdown; a flavor must be chosen before adding to
 * the cart. A single flavor is selected automatically. Out-of-stock products
 * and flavors stay visible but can't be added.
 */
export function ProductPanel({
  product,
  currency,
  initialFlavorId,
  layout,
  priority,
}: {
  product: ProductWithFlavors;
  currency: string;
  initialFlavorId?: string;
  layout: "card" | "detail";
  priority?: boolean;
}) {
  const { flavors } = product;
  const selectId = useId();
  const available = flavors.filter((f) => f.in_stock);
  const outOfStock = !product.in_stock || (flavors.length > 0 && available.length === 0);
  const [flavorId, setFlavorId] = useState<string>(() => {
    if (outOfStock) return "";
    if (flavors.length === 1) return flavors[0].id;
    return available.some((f) => f.id === initialFlavorId) ? initialFlavorId! : "";
  });
  const flavor = flavors.find((f) => f.id === flavorId) ?? null;
  const needsFlavor = !outOfStock && flavors.length > 0 && !flavor;
  const detail = layout === "detail";
  const image = publicStorageUrl("product-images", flavor?.image_path ?? product.image_path);

  const imageBox = (
    <div className={`relative overflow-hidden bg-subtle ${detail ? "aspect-square rounded-3xl border border-line" : "aspect-[5/4]"}`}>
      {image ? (
        <Image
          src={image}
          alt={flavor ? `${product.name} — ${flavor.name}` : product.name}
          fill
          priority={priority}
          sizes={detail ? "(min-width: 768px) 480px, 100vw" : "(min-width: 1024px) 380px, (min-width: 640px) 50vw, 100vw"}
          className="object-cover"
        />
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-muted">No image</div>
      )}
    </div>
  );

  const info = (
    <div className={detail ? "md:pt-2" : "flex flex-1 flex-col p-5"}>
      {product.category && <p className="text-xs font-semibold uppercase tracking-[0.22em] text-accent">{product.category}</p>}
      {detail ? (
        <h1 className="mt-1.5 text-2xl font-bold leading-tight tracking-tight sm:text-3xl">{product.name}</h1>
      ) : (
        <h2 className="mt-1.5 text-xl font-bold leading-snug tracking-tight">
          <Link href={`/p/${product.id}`} className="hover:underline hover:underline-offset-4">{product.name}</Link>
        </h2>
      )}
      <p className="tabular mt-2 flex flex-wrap items-center gap-2 text-lg">
        {formatMoney(product.price_cents, currency)}
        {outOfStock && <span className="rounded-full bg-subtle px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-danger">Out of stock</span>}
      </p>
      {product.sku && <p className="mt-0.5 text-sm text-muted">SKU {product.sku}</p>}

      {flavors.length > 0 && (
        <div className="mt-4">
          <label htmlFor={selectId} className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-accent">
            Flavor
          </label>
          {flavors.length === 1 ? (
            <p id={selectId} className="rounded-2xl bg-subtle px-4 py-3 text-[15px] font-semibold">
              {flavors[0].name}
              {!flavors[0].in_stock && <span className="font-normal text-danger"> — out of stock</span>}
            </p>
          ) : (
            <div className="relative">
              <select
                id={selectId}
                value={flavorId}
                onChange={(e) => setFlavorId(e.target.value)}
                disabled={outOfStock}
                aria-describedby={needsFlavor ? `${selectId}-hint` : undefined}
                className={`h-12 w-full appearance-none rounded-2xl border bg-subtle pl-4 pr-11 text-[15px] focus:border-accent focus:outline-none ${
                  flavor ? "border-accent/60 font-semibold text-ink" : "border-line text-muted"
                }`}
              >
                <option value="" disabled>
                  {outOfStock ? "All flavors out of stock" : `Select a flavor (${available.length}${available.length < flavors.length ? ` of ${flavors.length}` : ""} available)`}
                </option>
                {flavors.map((f) => (
                  <option key={f.id} value={f.id} disabled={!f.in_stock}>
                    {f.in_stock ? f.name : `${f.name} — out of stock`}
                  </option>
                ))}
              </select>
              <svg className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-muted" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="m6 9 6 6 6-6" />
              </svg>
            </div>
          )}
          {flavor && flavors.length > 1 && (
            <p className="mt-2 text-sm text-highlight" aria-live="polite">
              Selected: <span className="font-semibold">{flavor.name}</span>
            </p>
          )}
          {needsFlavor && (
            <p id={`${selectId}-hint`} className="mt-2 text-sm text-muted">Choose a flavor to add this to your cart.</p>
          )}
        </div>
      )}

      {product.description && (
        <p className={`mt-4 whitespace-pre-line text-[15px] leading-relaxed text-ink/75 ${detail ? "" : "line-clamp-3"}`}>{product.description}</p>
      )}

      <div className={detail ? "mt-6" : "mt-auto pt-5"}>
        <AddToCart
          key={flavorId || "none"}
          disabled={needsFlavor || outOfStock}
          disabledLabel={outOfStock ? "Out of Stock" : undefined}
          item={{
            productId: product.id,
            flavorId: flavor?.id ?? null,
            name: product.name,
            flavorName: flavor?.name ?? null,
            priceCents: product.price_cents,
            sku: product.sku,
            imagePath: flavor?.image_path ?? product.image_path,
          }}
        />
      </div>
    </div>
  );

  if (detail) {
    return (
      <div className="grid gap-8 md:grid-cols-2 md:gap-12">
        {imageBox}
        {info}
      </div>
    );
  }
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-3xl border border-line bg-card">
      <Link href={`/p/${product.id}`} tabIndex={-1} aria-hidden>
        {imageBox}
      </Link>
      {info}
    </article>
  );
}
