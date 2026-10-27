import type { Metadata } from "next";
import Link from "next/link";
import { getSettings } from "@/lib/settings";
import { isCatalog } from "@/lib/types";
import { getBrands, getCategories } from "../categories";
import { ProductForm } from "../product-form";

export const metadata: Metadata = { title: "Add product" };

export default async function NewProductPage({ searchParams }: PageProps<"/admin/products/new">) {
  const c = (await searchParams).catalog;
  const [categories, brands, settings] = await Promise.all([getCategories(), getBrands(), getSettings()]);
  return (
    <div>
      <Link href="/admin/products" className="text-sm text-muted hover:text-ink">← Products</Link>
      <h1 className="mb-6 mt-2 text-xl font-semibold tracking-tight">Add product</h1>
      <ProductForm imageUrl={null} categories={categories} brands={brands}
        defaultCatalog={isCatalog(c) ? c : "happy"} flavors={[]} currency={settings.currency} />
    </div>
  );
}
