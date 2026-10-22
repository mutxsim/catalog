import { formatMoney } from "@/lib/money";
import { STATUS_LABEL, type Order, type OrderItem } from "@/lib/types";

type SummaryOrder = Pick<Order, "order_number" | "business_name" | "currency" | "subtotal_cents" | "tax_label" | "tax_cents" | "total_cents" | "status" | "seller">;

/** The plain-text order summary sent to the owner (and prefilled in wa.me links). */
type SummaryItem = Pick<OrderItem, "name" | "quantity" | "line_total_cents"> & { flavor_name?: string | null };
const itemLabel = (i: SummaryItem) => (i.flavor_name ? `${i.name} (${i.flavor_name})` : i.name);

export function buildOrderSummary(order: SummaryOrder, items: SummaryItem[], opts: { attachmentNote?: string } = {}) {
  const m = (c: number) => formatMoney(c, order.currency);
  const lines = [
    "NEW WHOLESALE ORDER",
    "",
    `Order #: ${order.order_number}`,
    `Business: ${order.business_name}`,
    "",
    "Items:",
    ...items.map((i) => `• ${itemLabel(i)} × ${i.quantity} — ${m(i.line_total_cents)}`),
    "",
    `Subtotal: ${m(order.subtotal_cents)}`,
    ...(order.seller.tax_enabled ? [`${order.tax_label}: ${m(order.tax_cents)}`] : []),
    `TOTAL DUE: ${m(order.total_cents)}`,
    "",
    "Payment: In-store",
    `Status: ${STATUS_LABEL[order.status]}`,
  ];
  if (opts.attachmentNote) lines.push("", opts.attachmentNote);
  return lines.join("\n");
}

/**
 * Template parameters can't contain newlines or long runs of spaces.
 * Order: {{1}} order number, {{2}} business, {{3}} total due, {{4}} items.
 */
export function buildTemplateParams(order: SummaryOrder, items: SummaryItem[]) {
  const flat = (s: string) => s.replace(/\s+/g, " ").trim();
  const parts = items.map((i) => `${flat(itemLabel(i))} x${i.quantity} (${formatMoney(i.line_total_cents, order.currency)})`);
  let itemsText = "";
  for (let i = 0; i < parts.length; i++) {
    const next = itemsText ? `${itemsText}; ${parts[i]}` : parts[i];
    if (next.length > 600) {
      itemsText = `${itemsText}; +${parts.length - i} more (see PDF)`;
      break;
    }
    itemsText = next;
  }
  return [order.order_number, flat(order.business_name), formatMoney(order.total_cents, order.currency), itemsText];
}

/** Opens WhatsApp with a prefilled message. The user still has to press Send, and no file is attached. */
export function waMeLink(phoneDigits: string, text: string) {
  const digits = phoneDigits.replace(/\D/g, "");
  if (!digits) return null;
  const clipped = text.length > 1800 ? `${text.slice(0, 1780)}\n…` : text;
  return `https://wa.me/${digits}?text=${encodeURIComponent(clipped)}`;
}

/** Strip everything but digits; WhatsApp expects country code + number, no "+". */
export function normaliseWhatsAppNumber(input: string) {
  return input.replace(/\D/g, "");
}
