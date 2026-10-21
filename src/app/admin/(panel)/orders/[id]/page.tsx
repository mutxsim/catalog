import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { env } from "@/lib/env";
import { loadOrder, storeTimeZone } from "@/lib/invoice/service";
import { formatMoney } from "@/lib/money";
import { UUID_RE } from "@/lib/orders";
import { ORDER_STATUSES, STATUS_LABEL } from "@/lib/types";
import { StatusBadge, WHATSAPP_LABEL } from "@/components/admin/badges";
import { btn } from "@/components/ui";
import { updateStatus } from "../actions";
import { ResendButton } from "./resend-button";

export const metadata: Metadata = { title: "Order" };

export default async function OrderPage({ params }: PageProps<"/admin/orders/[id]">) {
  await requireAdmin();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const loaded = await loadOrder(id);
  if (!loaded) notFound();
  const { order, items } = loaded;
  const m = (c: number) => formatMoney(c, order.currency);
  const tz = storeTimeZone();
  const wa = order.whatsapp_status;
  const canResend = env.whatsapp.configured && ["failed", "not_configured", "pending"].includes(wa);
  const canSendAgain = env.whatsapp.configured && ["accepted", "sent", "delivered", "read"].includes(wa);

  return (
    <div className="max-w-4xl">
      <Link href="/admin/orders" className="text-sm text-muted hover:text-ink">← Orders</Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="tabular text-xl font-semibold tracking-tight">Order #{order.order_number}</h1>
          <p className="mt-1 text-[15px]">{order.business_name}</p>
          <p className="tabular mt-0.5 text-sm text-muted">
            {new Date(order.created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: tz })} · Invoice {order.invoice_number}
          </p>
        </div>
        <StatusBadge status={order.status} />
      </div>

      <form action={updateStatus} className="mt-6 flex flex-wrap gap-2" aria-label="Update status">
        <input type="hidden" name="id" value={order.id} />
        {ORDER_STATUSES.map((s) => (
          <button
            key={s}
            name="status"
            value={s}
            disabled={order.status === s}
            className={`h-9 rounded-lg border px-3 text-sm transition-colors ${
              order.status === s ? "border-ink bg-ink text-white" : "border-line bg-card text-ink hover:border-ink/40"
            }`}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </form>

      <div className="mt-8 overflow-x-auto rounded-xl border border-line bg-card">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3 font-medium">Item</th>
              <th className="px-2 py-3 font-medium">SKU</th>
              <th className="px-2 py-3 text-right font-medium">Qty</th>
              <th className="px-2 py-3 text-right font-medium">Unit price</th>
              <th className="px-4 py-3 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {items.map((i) => (
              <tr key={i.position} className="border-b border-line last:border-0">
                <td className="px-4 py-3">{i.name}</td>
                <td className="px-2 py-3 text-muted">{i.sku ?? "—"}</td>
                <td className="px-2 py-3 text-right">{i.quantity}</td>
                <td className="px-2 py-3 text-right">{m(i.unit_price_cents)}</td>
                <td className="px-4 py-3 text-right">{m(i.line_total_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="tabular ml-auto max-w-xs space-y-1.5 border-t border-line px-4 py-4 text-sm">
          <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd>{m(order.subtotal_cents)}</dd></div>
          {order.seller.tax_enabled && (
            <div className="flex justify-between"><dt className="text-muted">{order.tax_label} ({order.tax_rate}%)</dt><dd>{m(order.tax_cents)}</dd></div>
          )}
          <div className="flex justify-between pt-1 text-base font-semibold"><dt>Total due</dt><dd>{m(order.total_cents)}</dd></div>
          <div className="flex justify-between text-muted"><dt>Payment</dt><dd>In-store</dd></div>
        </dl>
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <section className="rounded-xl border border-line bg-card p-4">
          <h2 className="text-sm font-semibold">Invoice</h2>
          <p className="mt-1 text-sm text-muted">The original invoice issued at checkout. It never changes.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a href={`/admin/orders/${order.id}/invoice`} className={btn.secondary}>Download</a>
            <a href={`/admin/orders/${order.id}/invoice?view=1`} target="_blank" rel="noopener" className={btn.secondary}>Print</a>
          </div>
          {order.status !== "new" && (
            <a href={`/admin/orders/${order.id}/invoice?current=1&view=1`} target="_blank" rel="noopener" className="mt-3 inline-block text-sm text-muted underline underline-offset-4 hover:text-ink">
              Reprint showing current status ({STATUS_LABEL[order.status]})
            </a>
          )}
        </section>

        <section className="rounded-xl border border-line bg-card p-4">
          <h2 className="text-sm font-semibold">WhatsApp notification</h2>
          <p className="mt-1 text-sm">
            {WHATSAPP_LABEL[wa]}
            {order.whatsapp_attempts > 1 ? <span className="text-muted"> · {order.whatsapp_attempts} attempts</span> : null}
          </p>
          {wa === "accepted" && <p className="mt-1 text-xs text-muted">WhatsApp accepted the message. Delivery is confirmed once WhatsApp reports it (requires the webhook).</p>}
          {wa === "not_configured" && <p className="mt-1 text-xs text-muted">Automatic delivery is off. See Settings → WhatsApp delivery.</p>}
          {order.whatsapp_error && wa !== "accepted" && wa !== "delivered" && wa !== "read" && wa !== "sent" && (
            <p className="mt-2 break-words rounded-md bg-subtle px-2 py-1.5 font-mono text-xs text-danger">{order.whatsapp_error}</p>
          )}
          {(canResend || canSendAgain) && <ResendButton id={order.id} label={canResend ? "Retry send" : "Send again"} again={canSendAgain} />}
        </section>
      </div>
    </div>
  );
}
