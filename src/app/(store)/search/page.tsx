import type { Metadata } from "next";
import { requireCustomer } from "@/lib/customer-auth";
import { CatalogView } from "@/components/store/catalog-view";

export const metadata: Metadata = { title: "Search" };

/** Header search from pages outside a catalog: searches every catalog. */
export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  await requireCustomer();
  return <CatalogView catalog={null} searchParams={await searchParams} />;
}
