import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { storeTimeZone } from "@/lib/invoice/service";
import { ORDER_STATUSES, STATUS_LABEL, type OrderStatus, type WhatsAppStatus } from "@/lib/types";
import { StatusBadge, WhatsAppDot } from "@/components/admin/badges";
import { btn, input } from "@/components/ui";

export const metadata: Metadata = { title: "Orders" };
const PAGE_SIZE = 50;

type Row = {
  id: string;
  order_number: string;
  business_name: string;
  created_at: string;
  total_cents: number;
  currency: string;
  status: OrderStatus;
  whatsapp_status: WhatsAppStatus;
};

export default async function OrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  const { supabase } = await requireAdmin();
  const sp = await searchParams;
  const status = typeof sp.status === "string" && (ORDER_STATUSES as readonly string[]).includes(sp.status) ? (sp.status as OrderStatus) : null;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  const page = Math.max(1, Number(sp.page) || 1);

  let query = supabase
    .from("orders")
    .select("id, order_number, business_name, created_at, total_cents, currency, status, whatsapp_status", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (status) query = query.eq("status", status);
  if (q) {
    const term = q.replace(/[%_,()#]/g, " ").trim();
    query = /^\d+$/.test(term)
      ? query.or(`order_number.ilike.%${term}%,business_name.ilike.%${term}%`)
      : query.ilike("business_name", `%${term}%`);
  }
  const { data, count, error } = await query;
  const orders = (data ?? []) as Row[];
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const tz = storeTimeZone();

  const link = (next: { status?: string | null; page?: number }) => {
    const p = new URLSearchParams();
    const s = next.status === undefined ? status : next.status;
    if (s) p.set("status", s);
    if (q) p.set("q", q);
    if (next.page && next.page > 1) p.set("page", String(next.page));
    const str = p.toString();
    return `/admin/orders${str ? `?${str}` : ""}`;
  };

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Orders</h1>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0" aria-label="Filter by status">
          {[null, ...ORDER_STATUSES].map((s) => (
            <Link
              key={s ?? "all"}
              href={link({ status: s, page: 1 })}
              className={`shrink-0 rounded-md px-2.5 h-8 text-sm leading-8 ${status === s ? "bg-subtle font-medium text-ink" : "text-muted hover:text-ink"}`}
            >
              {s ? STATUS_LABEL[s] : "All"}
            </Link>
          ))}
        </nav>
        <form className="flex gap-2" role="search">
          {status && <input type="hidden" name="status" value={status} />}
          <input name="q" defaultValue={q} placeholder="Business or order #" className={`${input} h-9 sm:w-56`} />
          <button className={`${btn.secondary} h-9`}>Search</button>
        </form>
      </div>

      {error && <p className="mt-4 text-sm text-danger">Could not load orders.</p>}

      <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-card">
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3 font-medium">Order #</th>
              <th className="px-2 py-3 font-medium">Business</th>
              <th className="px-2 py-3 font-medium">Date</th>
              <th className="px-2 py-3 text-right font-medium">Total</th>
              <th className="px-2 py-3 font-medium">Status</th>
              <th className="px-2 py-3 font-medium">WhatsApp</th>
              <th className="px-4 py-3 text-right font-medium">Invoice</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-b border-line last:border-0 hover:bg-paper">
                <td className="tabular px-4 py-3">
                  <Link href={`/admin/orders/${o.id}`} className="font-medium underline-offset-4 hover:underline">#{o.order_number}</Link>
                </td>
                <td className="max-w-[220px] truncate px-2 py-3">
                  <Link href={`/admin/orders/${o.id}`}>{o.business_name}</Link>
                </td>
                <td className="tabular whitespace-nowrap px-2 py-3 text-muted">
                  {new Date(o.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz })}
                </td>
                <td className="tabular px-2 py-3 text-right">{formatMoney(Number(o.total_cents), o.currency)}</td>
                <td className="px-2 py-3"><StatusBadge status={o.status} /></td>
                <td className="px-2 py-3"><WhatsAppDot status={o.whatsapp_status} /></td>
                <td className="px-4 py-3 text-right">
                  <a href={`/admin/orders/${o.id}/invoice`} className={btn.small}>PDF</a>
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-14 text-center text-muted">
                  {q || status ? "No orders match." : "No orders yet. Share your catalog link with customers to start receiving orders."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-muted">
          <span>Page {page} of {pages}</span>
          <div className="flex gap-2">
            {page > 1 && <Link href={link({ page: page - 1 })} className={btn.small}>Previous</Link>}
            {page < pages && <Link href={link({ page: page + 1 })} className={btn.small}>Next</Link>}
          </div>
        </div>
      )}
    </div>
  );
}
