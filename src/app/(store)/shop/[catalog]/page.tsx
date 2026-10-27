import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireCustomer } from "@/lib/customer-auth";
import { CATALOG_LABEL, isCatalog } from "@/lib/types";
import { CatalogView } from "@/components/store/catalog-view";

export async function generateMetadata({ params }: PageProps<"/shop/[catalog]">): Promise<Metadata> {
  const { catalog } = await params;
  return { title: isCatalog(catalog) ? CATALOG_LABEL[catalog] : "Catalog" };
}

export default async function ShopPage({ params, searchParams }: PageProps<"/shop/[catalog]">) {
  await requireCustomer();
  const { catalog } = await params;
  if (!isCatalog(catalog)) notFound();
  return <CatalogView catalog={catalog} searchParams={await searchParams} />;
}
