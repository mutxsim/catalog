import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { renderInvoicePdf } from "@/lib/invoice/pdf";
import { sniffImage } from "@/lib/uploads";
import type { Order, OrderItem, OrderStatus } from "@/lib/types";

const ORDER_COLUMNS =
  "id, order_number, invoice_number, access_token, business_name, currency, subtotal_cents, tax_label, tax_rate, tax_cents, total_cents, seller, status, invoice_path, whatsapp_status, whatsapp_message_id, whatsapp_error, whatsapp_attempts, whatsapp_updated_at, created_at";

export function storeTimeZone() {
  return process.env.STORE_TIMEZONE?.trim() || "America/New_York";
}

export async function loadOrder(orderId: string): Promise<{ order: Order; items: OrderItem[] } | null> {
  const db = createServiceClient();
  const { data: order, error } = await db.from("orders").select(ORDER_COLUMNS).eq("id", orderId).maybeSingle();
  if (error) throw new Error(`Could not load order: ${error.message}`);
  if (!order) return null;
  const { data: items, error: itemsError } = await db
    .from("order_items")
    .select("position, name, sku, unit_price_cents, quantity, line_total_cents")
    .eq("order_id", orderId)
    .order("position");
  if (itemsError) throw new Error(`Could not load order items: ${itemsError.message}`);
  return {
    order: normaliseOrder(order as unknown as Order),
    items: (items ?? []).map((i) => ({ ...i, line_total_cents: Number(i.line_total_cents) })),
  };
}

function normaliseOrder(o: Order): Order {
  return {
    ...o,
    subtotal_cents: Number(o.subtotal_cents),
    tax_cents: Number(o.tax_cents),
    total_cents: Number(o.total_cents),
    tax_rate: Number(o.tax_rate),
  };
}

async function loadLogo(logoPath: string | null) {
  if (!logoPath) return null;
  const { data } = await createServiceClient().storage.from("branding").download(logoPath);
  if (!data) return null;
  const bytes = new Uint8Array(await data.arrayBuffer());
  const kind = sniffImage(bytes);
  if (!kind || kind.mime === "image/webp") return null;
  return { bytes, mime: kind.mime };
}

/** Render from the saved order snapshot. `statusOverride` is used for admin "current status" reprints. */
export async function renderOrderInvoice(order: Order, items: OrderItem[], statusOverride?: OrderStatus) {
  return renderInvoicePdf({
    order: { ...order, status: statusOverride ?? order.status },
    items,
    logo: await loadLogo(order.seller.logo_path),
    timeZone: storeTimeZone(),
  });
}

/**
 * Returns the stored invoice PDF, generating and storing it exactly once if it
 * does not exist yet. Once stored, the file is never regenerated or replaced.
 */
export async function ensureInvoice(orderId: string): Promise<{ bytes: Uint8Array; order: Order } | null> {
  const loaded = await loadOrder(orderId);
  if (!loaded) return null;
  const { order, items } = loaded;
  const db = createServiceClient();

  if (order.invoice_path) {
    const { data, error } = await db.storage.from("invoices").download(order.invoice_path);
    if (error || !data) throw new Error(`Stored invoice missing for order ${order.order_number}`);
    return { bytes: new Uint8Array(await data.arrayBuffer()), order };
  }

  // The original invoice always shows the status at the time of issue (New).
  const bytes = await renderOrderInvoice(order, items, "new");
  const path = `${order.created_at.slice(0, 7)}/${order.id}.pdf`;
  const { error: uploadError } = await db.storage
    .from("invoices")
    .upload(path, bytes, { contentType: "application/pdf", upsert: false });

  if (uploadError && !/exists|duplicate/i.test(uploadError.message)) {
    throw new Error(`Could not store invoice: ${uploadError.message}`);
  }

  // Only set the path if nobody else did first; then serve whatever is stored.
  await db
    .from("orders")
    .update({ invoice_path: path, invoice_generated_at: new Date().toISOString() })
    .eq("id", order.id)
    .is("invoice_path", null);

  const { data: stored } = await db.storage.from("invoices").download(path);
  return { bytes: stored ? new Uint8Array(await stored.arrayBuffer()) : bytes, order: { ...order, invoice_path: path } };
}
