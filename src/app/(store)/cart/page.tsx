import type { Metadata } from "next";
import { getSettings } from "@/lib/settings";
import { CartView } from "./cart-view";
import { requireCustomer } from "@/lib/customer-auth";

export const metadata: Metadata = { title: "Cart" };

export default async function CartPage() {
  await requireCustomer();
  const s = await getSettings();
  return <CartView currency={s.currency} />;
}
