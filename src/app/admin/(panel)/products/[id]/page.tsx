import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { publicStorageUrl } from "@/lib/public-url";
import { getSettings } from "@/lib/settings";
import type { Product } from "@/lib/types";
import { btn } from "@/components/ui";
import { deleteProduct } from "../actions";
import { getBrands, getCategories, getFlavorRows } from "../categories";
import { ProductForm } from "../product-form";
import { ConfirmButton } from "@/components/confirm-button";

export const metadata: Metadata = { title: "Edit product" };

export default async function EditProductPage({ params }: PageProps<"/admin/products/[id]">) {
  const { id } = await params;
  const { supabase } = await requireAdmin();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data } = await supabase.from("products").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const product = data as Product;
  const [categories, brands, flavors, settings] = await Promise.all([getCategories(), getBrands(), getFlavorRows(product.id), getSettings()]);

  return (
    <div>
      <Link href="/admin/products" className="text-sm text-muted hover:text-ink">← Products</Link>
      <h1 className="mb-6 mt-2 text-xl font-semibold tracking-tight">Edit product</h1>
      <ProductForm
        product={product}
        imageUrl={publicStorageUrl("product-images", product.image_path)}
        categories={categories}
        brands={brands}
        flavors={flavors}
        currency={settings.currency}
      />
      <form action={deleteProduct} className="mt-12 border-t border-line pt-6">
        <input type="hidden" name="id" value={product.id} />
        <p className="mb-3 text-sm text-muted">Deleting removes the product from the catalog. Its flavors are removed too. Past orders and invoices keep their original details.</p>
        <ConfirmButton message={`Delete “${product.name}”? This can't be undone.`} className={btn.danger}>
          Delete product
        </ConfirmButton>
      </form>
    </div>
  );
}
