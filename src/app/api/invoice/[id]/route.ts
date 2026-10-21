import { createServiceClient } from "@/lib/supabase/server";
import { ensureInvoice } from "@/lib/invoice/service";
import { invoiceFileName } from "@/lib/invoice/pdf";
import { tokensMatch, UUID_RE } from "@/lib/orders";

export const dynamic = "force-dynamic";

/** Customer invoice download. Requires the order's secret token — order numbers alone are not enough. */
export async function GET(req: Request, ctx: RouteContext<"/api/invoice/[id]">) {
  const { id } = await ctx.params;
  const token = new URL(req.url).searchParams.get("t");
  const notFound = () => new Response("Invoice not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!UUID_RE.test(id) || !token) return notFound();

  const { data } = await createServiceClient().from("orders").select("access_token").eq("id", id).maybeSingle();
  if (!data || !tokensMatch(token, data.access_token)) return notFound();

  try {
    const invoice = await ensureInvoice(id);
    if (!invoice) return notFound();
    const inline = new URL(req.url).searchParams.get("view") === "1";
    return new Response(invoice.bytes as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${invoiceFileName(invoice.order.invoice_number)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (e) {
    console.error(`[invoice] ${id}:`, (e as Error).message);
    return new Response("Invoice temporarily unavailable. Please try again.", { status: 503 });
  }
}
