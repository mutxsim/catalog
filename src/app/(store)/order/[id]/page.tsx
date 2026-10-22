import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { env } from "@/lib/env";
import { loadOrder } from "@/lib/invoice/service";
import { formatMoney } from "@/lib/money";
import { tokensMatch, UUID_RE } from "@/lib/orders";
import { getSettings } from "@/lib/settings";
import { buildOrderSummary, waMeLink } from "@/lib/whatsapp/message";
import { btn } from "@/components/ui";
import Image from "next/image";
import { requireCustomer } from "@/lib/customer-auth";
import { publicStorageUrl } from "@/lib/public-url";

export const metadata: Metadata = { title: "Order placed", referrer: "no-referrer" };

export default async function OrderConfirmationPage({ params, searchParams }: PageProps<"/order/[id]">) {
  const customer = await requireCustomer();
  const { id } = await params;
  const sp = await searchParams;
  const token = typeof sp.t === "string" ? sp.t : null;
  if (!UUID_RE.test(id) || !token) notFound();

  const loaded = await loadOrder(id);
  if (!loaded || !tokensMatch(token, loaded.order.access_token)) notFound();
  // Customers only ever see their own orders.
  if (loaded.order.customer_id && loaded.order.customer_id !== customer.customerId) notFound();
  const { order, items } = loaded;
  const settings = await getSettings();

  const invoiceUrl = `/api/invoice/${order.id}?t=${encodeURIComponent(token)}`;
  const autoDelivery = env.whatsapp.configured && Boolean(settings.whatsapp_number);
  const waLink = waMeLink(settings.whatsapp_number, buildOrderSummary({ ...order, status: "new" }, items));
  const pickup = order.seller.pickup_instructions?.trim();

  return (
    <main className="mx-auto max-w-lg px-4 pb-12 pt-10 sm:px-6 sm:pt-16">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent" aria-hidden>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m5 12.5 4.5 4.5L19 7.5" />
        </svg>
      </div>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight">Order Placed Successfully</h1>
      <p className="mt-2 text-[15px] text-muted">Payment is due in-store when you pick up your order.</p>

      <dl className="tabular mt-8 divide-y divide-line border-y border-line text-[15px]">
        <Row label="Order number" value={`#${order.order_number}`} />
        <Row label="Business" value={order.business_name} />
        <Row label="Total due in-store" value={formatMoney(order.total_cents, order.currency)} strong />
      </dl>

      <section aria-label="Invoice items" className="mt-8">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted">Invoice {order.invoice_number}</h2>
        <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-card">
          {items.map((i) => {
            const img = publicStorageUrl("product-images", i.image_path);
            const m = (c: number) => formatMoney(c, order.currency);
            return (
              <li key={i.position} className="flex items-start gap-3 p-3">
                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-subtle">
                  {img ? (
                    <Image src={img} alt="" fill sizes="56px" className="object-cover" />
                  ) : (
                    <span className="flex h-full items-center justify-center text-[10px] text-muted">No image</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] leading-snug">{i.name}</p>
                  {i.flavor_name && <p className="text-sm font-medium text-highlight">Flavor: {i.flavor_name}</p>}
                  <p className="tabular mt-0.5 text-sm text-muted">
                    {i.sku ? `${i.sku} · ` : ""}
                    {i.quantity} × {m(i.unit_price_cents)}
                  </p>
                </div>
                <p className="tabular shrink-0 text-[15px]">{m(i.line_total_cents)}</p>
              </li>
            );
          })}
        </ul>
        <dl className="tabular mt-3 space-y-1 px-1 text-sm">
          <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd>{formatMoney(order.subtotal_cents, order.currency)}</dd></div>
          {order.seller.tax_enabled && (
            <div className="flex justify-between"><dt className="text-muted">{order.tax_label} ({order.tax_rate}%)</dt><dd>{formatMoney(order.tax_cents, order.currency)}</dd></div>
          )}
        </dl>
      </section>

      {pickup && (
        <div className="mt-6">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted">Pickup</h2>
          <p className="mt-1.5 whitespace-pre-line text-[15px] leading-relaxed">{pickup}</p>
        </div>
      )}

      <div className="mt-8 flex flex-col gap-3">
        <a href={invoiceUrl} className={`${btn.primary} h-12`} download>
          Download Invoice
        </a>

        {!autoDelivery && waLink && (
          <div className="rounded-xl border border-line bg-card p-4">
            <p className="text-sm">Your order is saved. You can also send it to us on WhatsApp:</p>
            <a href={waLink} target="_blank" rel="noopener noreferrer" className={`${btn.secondary} mt-3 w-full`}>
              Send order on WhatsApp
            </a>
            <p className="mt-2 text-xs text-muted">
              This opens WhatsApp with your order details filled in — press Send to deliver it. The PDF invoice isn&apos;t attached automatically.
            </p>
          </div>
        )}
        {autoDelivery && waLink && (
          <a href={waMeLink(settings.whatsapp_number, `Hi, about order #${order.order_number} (${order.business_name}).`) ?? waLink} target="_blank" rel="noopener noreferrer" className={btn.ghost}>
            Questions? Message us on WhatsApp
          </a>
        )}
      </div>

      <p className="mt-8 text-xs text-muted">Save this page or the invoice — the link is private to your order.</p>
      <Link href="/" className="mt-6 inline-block text-sm underline underline-offset-4">Back to catalog</Link>
    </main>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4 py-3">
      <dt className="text-muted">{label}</dt>
      <dd className={`text-right ${strong ? "font-semibold" : ""}`}>{value}</dd>
    </div>
  );
}
