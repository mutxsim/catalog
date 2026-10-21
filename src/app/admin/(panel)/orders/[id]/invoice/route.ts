import { adminOrNull } from "@/lib/auth";
import { ensureInvoice, loadOrder, renderOrderInvoice } from "@/lib/invoice/service";
import { invoiceFileName } from "@/lib/invoice/pdf";
import { UUID_RE } from "@/lib/orders";

export const dynamic = "force-dynamic";

/**
 * Admin invoice download/print. By default serves the stored original.
 * `?current=1` renders a copy from the same saved snapshot showing the current order status.
 */
export async function GET(req: Request, ctx: RouteContext<"/admin/orders/[id]/invoice">) {
  if (!(await adminOrNull())) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);

  try {
    let bytes: Uint8Array;
    let invoiceNumber: string;
    if (url.searchParams.get("current") === "1") {
      const loaded = await loadOrder(id);
      if (!loaded) return new Response("Not found", { status: 404 });
      bytes = await renderOrderInvoice(loaded.order, loaded.items);
      invoiceNumber = loaded.order.invoice_number;
    } else {
      const invoice = await ensureInvoice(id);
      if (!invoice) return new Response("Not found", { status: 404 });
      bytes = invoice.bytes;
      invoiceNumber = invoice.order.invoice_number;
    }
    const inline = url.searchParams.get("view") === "1";
    return new Response(bytes as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${invoiceFileName(invoiceNumber)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    console.error(`[admin invoice] ${id}:`, (e as Error).message);
    return new Response("Invoice temporarily unavailable.", { status: 503 });
  }
}
