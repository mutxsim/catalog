"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useActionForm } from "@/components/use-action-form";
import { btn, hint, input, label, textarea } from "@/components/ui";
import { centsToInput } from "@/lib/money";
import type { Product } from "@/lib/types";
import { saveProduct } from "./actions";
import { FlavorEditor, type FlavorRow } from "./flavor-editor";

export function ProductForm({
  product,
  imageUrl,
  categories,
  flavors,
  currency,
}: {
  product?: Product;
  imageUrl: string | null;
  categories: string[];
  flavors: FlavorRow[];
  currency: string;
}) {
  const { state, pending, onSubmit } = useActionForm(saveProduct, null);
  const [preview, setPreview] = useState<string | null>(null);
  const [removeImage, setRemoveImage] = useState(false);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const shown = preview ?? (removeImage ? null : imageUrl);

  return (
    <form onSubmit={onSubmit} className="grid gap-8 md:grid-cols-[1fr_280px]">
      <input type="hidden" name="id" value={product?.id ?? ""} />

      <div className="space-y-5">
        <div>
          <label htmlFor="name" className={label}>Product name</label>
          <input id="name" name="name" required maxLength={200} defaultValue={product?.name} className={input} />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="price" className={label}>Selling price ({currency})</label>
            <input
              id="price"
              name="price"
              required
              inputMode="decimal"
              placeholder="0.00"
              defaultValue={product ? centsToInput(product.price_cents) : ""}
              className={`${input} tabular`}
            />
          </div>
          <div>
            <label htmlFor="sku" className={label}>SKU <span className="font-normal text-muted">(optional)</span></label>
            <input id="sku" name="sku" maxLength={64} defaultValue={product?.sku ?? ""} className={input} />
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="category" className={label}>Category <span className="font-normal text-muted">(optional)</span></label>
            <input id="category" name="category" maxLength={80} list="categories" defaultValue={product?.category ?? ""} className={input} />
            <datalist id="categories">
              {categories.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div>
            <label htmlFor="sort_order" className={label}>Display order</label>
            <input id="sort_order" name="sort_order" type="number" step={1} defaultValue={product?.sort_order ?? ""} placeholder="Auto" className={`${input} tabular`} />
            <p className={hint}>Lower numbers appear first.</p>
          </div>
        </div>

        <FlavorEditor initial={flavors} />

        <div>
          <label htmlFor="description" className={label}>Description <span className="font-normal text-muted">(optional)</span></label>
          <textarea id="description" name="description" rows={4} maxLength={5000} defaultValue={product?.description ?? ""} className={textarea} />
        </div>

        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-line bg-card px-3 py-3">
          <input type="checkbox" name="published" defaultChecked={product ? product.published : true} className="h-4 w-4 accent-[var(--color-accent)]" />
          <span className="text-sm">
            <span className="font-medium">Published</span>
            <span className="block text-muted">Visible to customers in the catalog.</span>
          </span>
        </label>

        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-line bg-card px-3 py-3">
          <input type="checkbox" name="in_stock" defaultChecked={product ? product.in_stock !== false : true} className="h-4 w-4 accent-[var(--color-accent)]" />
          <span className="text-sm">
            <span className="font-medium">In stock</span>
            <span className="block text-muted">Untick to show it as out of stock — customers can still see it but can&apos;t order it. Single flavors can be marked out of stock in the flavor list.</span>
          </span>
        </label>
      </div>

      <div>
        <span className={label}>Image</span>
        <div className="relative aspect-square overflow-hidden rounded-xl border border-line bg-subtle">
          {shown ? (
            preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="" className="h-full w-full object-cover" />
            ) : (
              <Image src={shown} alt="" fill sizes="280px" className="object-cover" />
            )
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted">No image</div>
          )}
        </div>
        <input
          name="image"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => {
            const f = e.target.files?.[0];
            setPreview(f ? URL.createObjectURL(f) : null);
          }}
          className="mt-3 w-full text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-card file:px-3 file:py-1.5 file:text-sm"
        />
        <p className={hint}>JPG, PNG or WebP, up to 5 MB. Square images look best.</p>
        {imageUrl && !preview && (
          <label className="mt-3 flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" name="remove_image" checked={removeImage} onChange={(e) => setRemoveImage(e.target.checked)} />
            Remove image
          </label>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 md:col-span-2">
        <button type="submit" disabled={pending} className={btn.primary}>{pending ? "Saving…" : product ? "Save changes" : "Add product"}</button>
        <Link href="/admin/products" className={btn.ghost}>Cancel</Link>
        {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      </div>
    </form>
  );
}
