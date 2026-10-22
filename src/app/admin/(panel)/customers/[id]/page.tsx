import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { storeTimeZone } from "@/lib/invoice/service";
import { UUID_RE } from "@/lib/orders";
import { SESSION_IDLE_DAYS } from "@/lib/customer-auth";
import {
  DEVICE_LABEL, EVENT_COLUMNS, browserLabel, formatWhen, location, sessionEnd, sessionStatus,
  type LoginEvent, type SessionRow,
} from "@/lib/activity";
import { btn } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { deleteCustomer, setCustomerActive } from "../actions";
import { RenameForm, RegenerateForm } from "./forms";
import { Result } from "@/components/admin/login-result";

export const metadata: Metadata = { title: "Customer" };

type Customer = { id: string; name: string; active: boolean; code_hint: string | null; created_at: string; last_login_at: string | null; deleted_at: string | null };

export default async function CustomerPage({ params, searchParams }: PageProps<"/admin/customers/[id]">) {
  const { supabase } = await requireAdmin();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const PAGE = 50;
  const tz = storeTimeZone();

  const { data: c } = await supabase.from("customers").select("id, name, active, code_hint, created_at, last_login_at, deleted_at").eq("id", id).maybeSingle();
  if (!c) notFound();
  const customer = c as Customer;

  const [{ data: events, count }, { count: successCount }, { count: orderCount }] = await Promise.all([
    supabase.from("login_events").select(EVENT_COLUMNS, { count: "exact" }).eq("customer_id", id).order("created_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1),
    supabase.from("login_events").select("id", { count: "exact", head: true }).eq("customer_id", id).eq("success", true),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("customer_id", id),
  ]);
  const rows = (events ?? []) as LoginEvent[];
  const sessionIds = rows.map((e) => e.session_id).filter((s): s is string => Boolean(s));
  const { data: sessions } = sessionIds.length
    ? await supabase.from("customer_sessions").select("id, created_at, last_seen_at, expires_at, ended_at, end_reason").in("id", sessionIds)
    : { data: [] };
  const sessionById = new Map(((sessions ?? []) as SessionRow[]).map((s) => [s.id, s]));
  const lastSuccess = rows.find((e) => e.success);
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
  const deleted = Boolean(customer.deleted_at);

  return (
    <div className="max-w-5xl">
      <Link href="/admin/customers" className="text-sm text-muted hover:text-ink">← Customers</Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{customer.name}</h1>
          <p className="mt-1 text-sm text-muted">
            Customer ID <span className="font-mono text-xs">{customer.id}</span> · Created {formatWhen(customer.created_at, tz)}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${deleted ? "bg-subtle text-danger" : customer.active ? "bg-accent-soft text-accent" : "bg-subtle text-muted"}`}>
          {deleted ? "Removed" : customer.active ? "Active" : "Inactive"}
        </span>
      </div>

      <dl className="mt-6 grid gap-3 sm:grid-cols-4">
        <Stat label="Most recent login" value={customer.last_login_at ? formatWhen(customer.last_login_at, tz) : "Never"} />
        <Stat label="Successful logins" value={String(successCount ?? 0)} />
        <Stat label="Last login location" value={lastSuccess ? location(lastSuccess) : "—"} />
        <Stat label="Orders" value={String(orderCount ?? 0)} />
      </dl>

      {!deleted && (
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <section className="rounded-xl border border-line bg-card p-4">
            <h2 className="text-sm font-semibold">Account</h2>
            <RenameForm id={customer.id} name={customer.name} />
            <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
              <form action={setCustomerActive}>
                <input type="hidden" name="id" value={customer.id} />
                <input type="hidden" name="active" value={String(!customer.active)} />
                {customer.active ? (
                  <ConfirmButton message={`Deactivate ${customer.name}? They'll be signed out immediately and can't log in until reactivated.`} className={btn.secondary}>
                    Deactivate
                  </ConfirmButton>
                ) : (
                  <button className={btn.secondary}>Activate</button>
                )}
              </form>
              <form action={deleteCustomer}>
                <input type="hidden" name="id" value={customer.id} />
                <ConfirmButton message={`Remove ${customer.name}? Their access code stops working. Past orders, invoices and login history are kept.`} className={btn.danger}>
                  Delete account
                </ConfirmButton>
              </form>
            </div>
          </section>

          <section className="rounded-xl border border-line bg-card p-4">
            <h2 className="text-sm font-semibold">Access code</h2>
            <p className="mt-1 text-sm text-muted">
              Current code ends in <span className="font-mono">{customer.code_hint ?? "—"}</span>. Codes are stored scrambled, so the full code is only shown when
              it&apos;s generated.
            </p>
            <RegenerateForm id={customer.id} name={customer.name} />
          </section>
        </div>
      )}

      <section className="mt-10">
        <h2 className="text-base font-semibold">Login history</h2>
        <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-card">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-medium">Date &amp; time</th>
                <th className="px-2 py-3 font-medium">Result</th>
                <th className="px-2 py-3 font-medium">Location</th>
                <th className="px-2 py-3 font-medium">IP address</th>
                <th className="px-2 py-3 font-medium">Device &amp; browser</th>
                <th className="px-2 py-3 font-medium">Session</th>
                <th className="px-4 py-3 font-medium">Last activity / ended</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const s = e.session_id ? sessionById.get(e.session_id) : undefined;
                const st = sessionStatus(s, SESSION_IDLE_DAYS);
                const end = sessionEnd(s, SESSION_IDLE_DAYS);
                return (
                  <tr key={e.id} className="border-b border-line last:border-0 align-top">
                    <td className="tabular whitespace-nowrap px-4 py-3">{formatWhen(e.created_at, tz)}</td>
                    <td className="px-2 py-3"><Result e={e} /></td>
                    <td className="px-2 py-3 text-muted">{location(e)}</td>
                    <td className="px-2 py-3 font-mono text-xs">{e.ip ?? "Unknown"}</td>
                    <td className="px-2 py-3 text-muted">{DEVICE_LABEL[e.device_type] ?? "Unknown"} · {browserLabel(e)}</td>
                    <td className="px-2 py-3">
                      <span className={st.tone === "active" ? "font-medium text-accent" : "text-muted"}>{st.label}</span>
                    </td>
                    <td className="tabular whitespace-nowrap px-4 py-3 text-muted">
                      {s ? (end ? `Ended ${formatWhen(end, tz)}` : `Last seen ${formatWhen(s.last_seen_at, tz)}`) : "—"}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-muted">No login attempts yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="mt-3 flex items-center justify-between text-sm text-muted">
            <span>Page {page} of {pages}</span>
            <div className="flex gap-2">
              {page > 1 && <Link href={`/admin/customers/${id}?page=${page - 1}`} className={btn.small}>Newer</Link>}
              {page < pages && <Link href={`/admin/customers/${id}?page=${page + 1}`} className={btn.small}>Older</Link>}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-card px-4 py-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 text-sm font-medium">{value}</dd>
    </div>
  );
}
