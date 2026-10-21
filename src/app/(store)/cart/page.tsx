import type { Metadata } from "next";
import { getSettings } from "@/lib/settings";
import { CartView } from "./cart-view";

export const metadata: Metadata = { title: "Cart" };

export default async function CartPage() {
  const s = await getSettings();
  return <CartView currency={s.currency} />;
}
