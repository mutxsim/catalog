import "server-only";
import { env } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/server";
import { ensureInvoice, loadOrder } from "@/lib/invoice/service";
import { invoiceFileName } from "@/lib/invoice/pdf";
import { getSettings } from "@/lib/settings";
import { buildOrderSummary, buildTemplateParams, normaliseWhatsAppNumber } from "@/lib/whatsapp/message";
import { sendDocument, sendDocumentTemplate, sendText, uploadPdf } from "@/lib/whatsapp/cloud";

const CAPTION_LIMIT = 1024;

export type NotifyResult = { status: "accepted" | "failed" | "not_configured" | "skipped"; error?: string };

/**
 * Sends the order summary and the stored invoice PDF to the owner's WhatsApp.
 * Safe to call repeatedly: an order is claimed atomically before sending.
 * "accepted" means WhatsApp accepted the message; delivery is confirmed later by webhook.
 */
export async function notifyOrder(orderId: string): Promise<NotifyResult> {
  const db = createServiceClient();
  const settings = await getSettings();
  const to = normaliseWhatsAppNumber(settings.whatsapp_number);

  if (!env.whatsapp.configured || !to) {
    await db
      .from("orders")
      .update({
        whatsapp_status: "not_configured",
        whatsapp_error: !env.whatsapp.configured ? "WhatsApp Cloud API credentials are not set." : "No WhatsApp number in Settings.",
        whatsapp_updated_at: new Date().toISOString(),
      })
      .eq("id", orderId)
      .in("whatsapp_status", ["pending", "not_configured"]);
    return { status: "not_configured" };
  }

  const { data: claimed, error: claimError } = await db.rpc("claim_whatsapp_send", { p_order_id: orderId });
  if (claimError) return { status: "failed", error: claimError.message };
  if (!claimed) return { status: "skipped" };

  try {
    const invoice = await ensureInvoice(orderId);
    const loaded = await loadOrder(orderId);
    if (!invoice || !loaded) throw new Error("Order not found");
    const { order, items } = loaded;
    const filename = invoiceFileName(order.invoice_number);
    const mediaId = await uploadPdf(invoice.bytes, filename);

    let messageId: string;
    if (env.whatsapp.templateName) {
      // Template messages work any time (no 24-hour window).
      messageId = await sendDocumentTemplate(to, mediaId, filename, buildTemplateParams({ ...order, status: "new" }, items));
    } else {
      const summary = buildOrderSummary({ ...order, status: "new" }, items, { attachmentNote: "Invoice: Attached PDF" });
      if (summary.length <= CAPTION_LIMIT) {
        messageId = await sendDocument(to, mediaId, filename, summary);
      } else {
        await sendText(to, summary);
        messageId = await sendDocument(to, mediaId, filename, `Invoice ${order.invoice_number} — ${order.business_name}`);
      }
    }

    await db
      .from("orders")
      .update({ whatsapp_status: "accepted", whatsapp_message_id: messageId, whatsapp_error: null, whatsapp_updated_at: new Date().toISOString() })
      .eq("id", orderId);
    return { status: "accepted" };
  } catch (e) {
    const message = (e as Error).message.slice(0, 500);
    await db
      .from("orders")
      .update({ whatsapp_status: "failed", whatsapp_error: message, whatsapp_updated_at: new Date().toISOString() })
      .eq("id", orderId);
    console.error(`[whatsapp] order ${orderId}: ${message}`);
    return { status: "failed", error: message };
  }
}
