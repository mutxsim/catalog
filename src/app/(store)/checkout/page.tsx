import type { Metadata } from "next";
import { getSettings } from "@/lib/settings";
import { CheckoutView } from "./checkout-view";
import { requireCustomer } from "@/lib/customer-auth";

export const metadata: Metadata = { title: "Checkout" };

export default async function CheckoutPage() {
  const customer = await requireCustomer();
  const s = await getSettings();
  return <CheckoutView currency={s.currency} defaultBusinessName={customer.customerName} />;
}
