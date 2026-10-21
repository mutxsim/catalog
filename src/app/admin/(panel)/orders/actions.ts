"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/types";
import { notifyOrder } from "@/lib/whatsapp/notify";
import { createServiceClient } from "@/lib/supabase/server";

export async function updateStatus(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "") as OrderStatus;
  if (!ORDER_STATUSES.includes(status)) return;
  await supabase.from("orders").update({ status }).eq("id", id);
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${id}`);
}

export async function resendWhatsApp(_prev: unknown, formData: FormData): Promise<{ message: string; ok: boolean }> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (formData.get("force") === "1") {
    // Explicit "send again" for an order that was already delivered.
    await createServiceClient()
      .from("orders")
      .update({ whatsapp_status: "pending" })
      .eq("id", id)
      .in("whatsapp_status", ["accepted", "sent", "delivered", "read"]);
  }
  const result = await notifyOrder(id);
  revalidatePath(`/admin/orders/${id}`);
  revalidatePath("/admin/orders");
  switch (result.status) {
    case "accepted":
      return { ok: true, message: "Accepted by WhatsApp. Delivery is confirmed when WhatsApp reports it." };
    case "not_configured":
      return { ok: false, message: "WhatsApp isn't configured. Add the API credentials and your number first." };
    case "skipped":
      return { ok: false, message: "A send is already in progress or this order was already sent." };
    default:
      return { ok: false, message: `Send failed: ${result.error ?? "unknown error"}` };
  }
}
