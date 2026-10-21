import type { Metadata } from "next";
import Link from "next/link";
import { getSettings } from "@/lib/settings";
import { getCategories, getGroups } from "../categories";
import { ProductForm } from "../product-form";

export const metadata: Metadata = { title: "Add product" };

export default async function NewProductPage() {
  const [categories, groups, settings] = await Promise.all([getCategories(), getGroups(), getSettings()]);
  return (
    <div>
      <Link href="/admin/products" className="text-sm text-muted hover:text-ink">← Products</Link>
      <h1 className="mb-6 mt-2 text-xl font-semibold tracking-tight">Add product</h1>
      <ProductForm imageUrl={null} categories={categories}
        groups={groups} currency={settings.currency} />
    </div>
  );
}
