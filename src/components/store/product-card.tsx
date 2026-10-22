import Image from "next/image";
import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { publicStorageUrl } from "@/lib/public-url";
import type { Product } from "@/lib/types";
import { AddToCart } from "./add-to-cart";

export function ProductCard({ product, currency, priority }: { product: Product; currency: string; priority?: boolean }) {
  const img = publicStorageUrl("product-images", product.image_path);
  return (
    <article className="flex h-full flex-col">
      <Link href={`/p/${product.id}`} className="group block">
        <div className="relative aspect-square overflow-hidden rounded-xl bg-subtle">
          {img ? (
            <Image
              src={img}
              alt={product.name}
              fill
              priority={priority}
              sizes="(min-width: 1024px) 270px, (min-width: 768px) 30vw, 46vw"
              className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted">No image</div>
          )}
        </div>
        <h2 className="mt-3 line-clamp-2 text-[15px] font-medium leading-snug">{product.name}</h2>
      </Link>
      {product.sku && <p className="mt-0.5 text-xs text-muted">SKU {product.sku}</p>}
      <p className="tabular mt-1 text-[15px]">{formatMoney(product.price_cents, currency)}</p>
      <div className="mt-auto pt-3">
        <AddToCart
          compact
          item={{ productId: product.id, name: product.name, priceCents: product.price_cents, sku: product.sku, imagePath: product.image_path }}
        />
      </div>
    </article>
  );
}
