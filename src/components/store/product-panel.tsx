"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { lineName, variantLabel } from "@/lib/catalog";
import { formatMoney } from "@/lib/money";
import { publicStorageUrl } from "@/lib/public-url";
import type { Product } from "@/lib/types";
import { AddToCart } from "./add-to-cart";

const DROPDOWN_AT = 6;

/**
 * A product card (grid) or full product view (detail page). When a product has
 * several flavors, the selected flavor drives the image, SKU, price and what
 * is added to the cart.
 */
export function ProductPanel({
  title,
  category,
  variants,
  currency,
  initialId,
  layout,
  priority,
}: {
  title: string;
  category: string | null;
  variants: Product[];
  currency: string;
  initialId?: string;
  layout: "card" | "detail";
  priority?: boolean;
}) {
  const [selectedId, setSelectedId] = useState(() => (variants.some((v) => v.id === initialId) ? initialId! : variants[0].id));
  const selected = variants.find((v) => v.id === selectedId) ?? variants[0];
  const hasFlavors = variants.length > 1 || Boolean(selected.variant_name);
  const image =
    publicStorageUrl("product-images", selected.image_path) ??
    publicStorageUrl("product-images", variants.find((v) => v.image_path)?.image_path);
  const description = selected.description ?? variants.find((v) => v.description)?.description ?? null;
  const detail = layout === "detail";

  const choose = (id: string) => {
    setSelectedId(id);
    if (detail) {
      try {
        window.history.replaceState(null, "", `/p/${id}`);
      } catch {}
    }
  };

  const imageBox = (
    <div className={`relative overflow-hidden bg-subtle ${detail ? "aspect-square rounded-3xl border border-line" : "aspect-[5/4]"}`}>
      {image ? (
        <Image
          src={image}
          alt={hasFlavors ? `${title} — ${variantLabel(selected)}` : title}
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

  const titleEl = detail ? (
    <h1 className="mt-1.5 text-2xl font-bold leading-tight tracking-tight sm:text-3xl">{title}</h1>
  ) : (
    <h2 className="mt-1.5 text-xl font-bold leading-snug tracking-tight">
      <Link href={`/p/${selected.id}`} className="hover:underline hover:underline-offset-4">{title}</Link>
    </h2>
  );

  const info = (
    <div className={detail ? "md:pt-2" : "flex flex-1 flex-col p-5"}>
      {category && <p className="text-xs font-semibold uppercase tracking-[0.22em] text-accent">{category}</p>}
      {titleEl}
      {!hasFlavors && <p className="tabular mt-2 text-lg">{formatMoney(selected.price_cents, currency)}</p>}
      {selected.sku && <p className="mt-0.5 text-sm text-muted">SKU {selected.sku}</p>}

      {hasFlavors && (
        <>
          <div className="mt-4 rounded-2xl bg-subtle px-4 py-3" aria-live="polite">
            <p className="text-[17px] font-semibold leading-snug">{variantLabel(selected)}</p>
            <p className="tabular text-[15px] font-medium text-highlight">{formatMoney(selected.price_cents, currency)}</p>
          </div>

          {variants.length > 1 && (
            <div className="mt-3 rounded-2xl border border-line p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Flavors</p>
              <div role="group" aria-label={`Flavors of ${title}`} className="mt-3 flex flex-wrap gap-2">
                {variants.map((v) => {
                  const on = v.id === selected.id;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => choose(v.id)}
                      className={`min-h-9 rounded-full px-3.5 py-1.5 text-sm transition-colors ${
                        on ? "bg-accent-soft text-ink ring-1 ring-accent" : "bg-subtle text-ink/85 hover:text-ink"
                      }`}
                    >
                      {variantLabel(v)}
                      {on && <span aria-hidden> ✓</span>}
                    </button>
                  );
                })}
              </div>
              {variants.length > DROPDOWN_AT && (
                <select
                  aria-label={`Select a flavor of ${title}`}
                  value={selected.id}
                  onChange={(e) => choose(e.target.value)}
                  className="mt-3 h-11 w-full rounded-xl border border-line bg-card px-3 text-[15px] text-ink focus:border-accent focus:outline-none"
                >
                  {variants.map((v) => (
                    <option key={v.id} value={v.id}>{variantLabel(v)}</option>
                  ))}
                </select>
              )}
            </div>
          )}
        </>
      )}

      {description && (
        <p className={`mt-4 whitespace-pre-line text-[15px] leading-relaxed text-ink/75 ${detail ? "" : "line-clamp-3"}`}>{description}</p>
      )}

      <div className={detail ? "mt-6" : "mt-auto pt-5"}>
        <AddToCart
          key={selected.id}
          item={{ productId: selected.id, name: lineName(selected), priceCents: selected.price_cents, sku: selected.sku, imagePath: selected.image_path }}
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
      <Link href={`/p/${selected.id}`} tabIndex={-1} aria-hidden>
        {imageBox}
      </Link>
      {info}
    </article>
  );
}
