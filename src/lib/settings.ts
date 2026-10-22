import "server-only";
import { cache } from "react";
import { createPublicClient } from "@/lib/supabase/server";
import type { Settings } from "@/lib/types";

export const DEFAULT_SETTINGS: Settings = {
  business_name: "",
  logo_path: null,
  address: "",
  whatsapp_number: "",
  currency: "USD",
  invoice_prefix: "INV-",
  tax_enabled: false,
  tax_label: "Tax",
  tax_rate: 0,
  invoice_footer: "",
  pickup_instructions: "",
  retention_years: 7,
};

export const getSettings = cache(async (): Promise<Settings> => {
  const { data, error } = await createPublicClient()
    .from("settings")
    .select("business_name, logo_path, address, whatsapp_number, currency, invoice_prefix, tax_enabled, tax_label, tax_rate, invoice_footer, pickup_instructions, retention_years, login_retention_days")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(`Could not load settings: ${error.message}`);
  return data ? { ...data, tax_rate: Number(data.tax_rate) } : DEFAULT_SETTINGS;
});

/** What customers see in the header when no business name is configured. */
export function displayName(s: Settings) {
  return s.business_name.trim() || "Catalog";
}
