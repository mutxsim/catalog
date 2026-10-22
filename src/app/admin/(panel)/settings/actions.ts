"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { MAX_LOGO_BYTES, readUpload } from "@/lib/uploads";
import { firstError, settingsSchema } from "@/lib/validation";

export type SettingsState = { error?: string; ok?: string } | null;

export async function saveSettings(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const { supabase } = await requireAdmin();
  const s = (k: string) => String(formData.get(k) ?? "");

  const parsed = settingsSchema.safeParse({
    business_name: s("business_name"),
    address: s("address"),
    whatsapp_number: s("whatsapp_number"),
    currency: s("currency"),
    invoice_prefix: s("invoice_prefix"),
    tax_enabled: formData.get("tax_enabled") === "on",
    tax_label: s("tax_label") || "Tax",
    tax_rate: s("tax_rate") || "0",
    invoice_footer: s("invoice_footer"),
    pickup_instructions: s("pickup_instructions"),
    retention_years: s("retention_years") || "7",
    login_retention_days: s("login_retention_days") || "365",
  });
  if (!parsed.success) return { error: firstError(parsed.error) };

  const upload = await readUpload(formData.get("logo"), MAX_LOGO_BYTES, ["image/png", "image/jpeg"]);
  if (upload && "error" in upload) return { error: upload.error };

  const storage = createServiceClient().storage.from("branding");
  let logo_path: string | null | undefined;

  if (upload) {
    logo_path = `logo/${randomUUID()}.${upload.kind.ext}`;
    const { error } = await storage.upload(logo_path, upload.bytes, { contentType: upload.kind.mime, cacheControl: "31536000" });
    if (error) return { error: "Logo upload failed. Please try again." };
  } else if (formData.get("remove_logo") === "on") {
    logo_path = null;
  }

  const { error } = await supabase
    .from("settings")
    .update({ ...parsed.data, ...(logo_path !== undefined ? { logo_path } : {}) })
    .eq("id", 1);
  if (error) {
    if (logo_path) await storage.remove([logo_path]);
    return { error: "Could not save settings." };
  }
  // Old logos are kept: past invoices reference the logo that was current when they were issued.

  revalidatePath("/", "layout");
  return { ok: "Settings saved." };
}

export async function purgeExpiredOrders(): Promise<SettingsState> {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.rpc("purge_expired_orders");
  if (error) return { error: "Could not remove old records." };
  const rows = (data ?? []) as { order_id: string; invoice_path: string | null }[];
  const paths = rows.map((r) => r.invoice_path).filter((p): p is string => Boolean(p));
  if (paths.length) await createServiceClient().storage.from("invoices").remove(paths);
  revalidatePath("/admin/orders");
  return { ok: rows.length ? `Removed ${rows.length} completed or cancelled order${rows.length === 1 ? "" : "s"} past the retention period.` : "Nothing to remove." };
}
