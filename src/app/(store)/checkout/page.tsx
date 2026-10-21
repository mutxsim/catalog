import type { Metadata } from "next";
import { getSettings } from "@/lib/settings";
import { CheckoutView } from "./checkout-view";

export const metadata: Metadata = { title: "Checkout" };

export default async function CheckoutPage() {
  const s = await getSettings();
  return <CheckoutView currency={s.currency} />;
}
