import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { storeTimeZone } from "@/lib/invoice/service";
import { DEVICE_LABEL, EVENT_COLUMNS, browserLabel, formatWhen, location, zonedDayStart, type LoginEvent } from "@/lib/activity";
import { Result } from "@/components/admin/login-result";
import { btn, input } from "@/components/ui";
import { PurgeLoginEvents } from "./purge";

export const metadata: Metadata = { title: "Login Activity" };
const PAGE_SIZE = 50;
const DEVICES = ["desktop", "mobile", "tablet", "unknown"] as const;

type Summary = { successes: number; unique_customers: number; last_success_at: string | null; failures: number };

export default async function ActivityPage({ searchParams }: PageProps<"/admin/activity">) {
  const { supabase } = await requireAdmin();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const q = str("q").slice(0, 100);
  const customerId = /^[0-9a-f-]{36}$/i.test(str("customer")) ? str("customer") : "";
  const result = str("result") === "success" || str("result") === "failed" ? str("result") : "";
  const device = (DEVICES as readonly string[]).includes(str("device")) ? str("device") : "";
  const from = str("from");
  const to = str("to");
  const page = Math.max(1, Number(sp.page) || 1);
  const tz = storeTimeZone();

  const fromIso = from ? zonedDayStart(from, tz) : null;
  // "to" is inclusive: everything before the start of the following day.
  const toIso = to ? (() => {
    const d = new Date(`${to}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return null;
    d.setUTCDate(d.getUTCDate() + 1);
    return zonedDayStart(d.toISOString().slice(0, 10), tz);
  })() : null;

  // Customer filter: a specific account, or every account whose name matches.
  let customerIds: string[] | null = customerId ? [customerId] : null;
  if (!customerIds && q) {
    const { data } = await supabase.from("customers").select("id").ilike("name", `%${q.replace(/[%_]/g, " ")}%`).limit(500);
    customerIds = (data ?? []).map((c) => c.id as string);
  }
  const noMatch = customerIds !== null && customerIds.length === 0;

  let query = supabase.from("login_events").select(EVENT_COLUMNS, { count: "exact" }).order("created_at", { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (fromIso) query = query.gte("created_at", fromIso);
  if (toIso) query = query.lt("created_at", toIso);
  if (customerIds) query = query.in("customer_id", noMatch ? ["00000000-0000-0000-0000-000000000000"] : customerIds);
  if (device) query = query.eq("device_type", device);
  if (result) query = query.eq("success", result === "success");

  const [{ data, count, error }, { data: summaryData }] = await Promise.all([
    query,
    supabase.rpc("login_activity_summary", {
      p_from: fromIso,
      p_to: toIso,
      p_customer_ids: customerIds ? (noMatch ? ["00000000-0000-0000-0000-000000000000"] : customerIds) : null,
      p_device: device || null,
    }),
  ]);
  const events = (data ?? []) as LoginEvent[];
  const summary = (summaryData ?? { successes: 0, unique_customers: 0, last_success_at: null, failures: 0 }) as Summary;
  const ids = [...new Set(events.map((e) => e.customer_id).filter((x): x is string => Boolean(x)))];
  const { data: names } = ids.length ? await supabase.from("customers").select("id, name, deleted_at").in("id", ids) : { data: [] };
  const nameById = new Map((names ?? []).map((n) => [n.id as string, { name: n.name as string, deleted: Boolean(n.deleted_at) }]));
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  const params = { q, customer: customerId, result, device, from, to };
  const link = (patch: Partial<typeof params & { page: string }>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, ...patch })) if (v) p.set(k, String(v));
    const s = p.toString();
    return `/admin/activity${s ? `?${s}` : ""}`;
  };
  const filtered = Boolean(q || customerId || result || device || from || to);

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Login Activity</h1>
      <p className="mt-1 text-sm text-muted">Times shown in {tz}. Location is approximate (from the connection&apos;s IP address) and may reflect a VPN or mobile carrier.</p>

      <dl className="mt-5 grid gap-3 sm:grid-cols-4">
        <Stat label="Successful logins" value={String(summary.successes)} />
        <Stat label="Unique customers" value={String(summary.unique_customers)} />
        <Stat label="Most recent successful login" value={summary.last_success_at ? formatWhen(summary.last_success_at, tz) : "—"} />
        <Stat label="Failed attempts" value={String(summary.failures)} danger={summary.failures > 0} />
      </dl>
      {filtered && <p className="mt-2 text-xs text-muted">Totals reflect the selected customer, dates and device.</p>}

      <form className="mt-6 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto_auto_auto]" role="search">
        {customerId && <input type="hidden" name="customer" value={customerId} />}
        <input name="q" defaultValue={q} placeholder="Customer name" aria-label="Customer" className={`${input} h-9`} />
        <input type="date" name="from" defaultValue={from} aria-label="From date" className={`${input} h-9`} />
        <input type="date" name="to" defaultValue={to} aria-label="To date" className={`${input} h-9`} />
        <select name="result" defaultValue={result} aria-label="Result" className={`${input} h-9`}>
          <option value="">All results</option>
          <option value="success">Successful</option>
          <option value="failed">Failed</option>
        </select>
        <select name="device" defaultValue={device} aria-label="Device" className={`${input} h-9`}>
          <option value="">All devices</option>
          {DEVICES.map((d) => <option key={d} value={d}>{DEVICE_LABEL[d]}</option>)}
        </select>
        <div className="flex gap-2">
          <button className={`${btn.secondary} h-9`}>Filter</button>
          {filtered && <Link href="/admin/activity" className={btn.ghost}>Clear</Link>}
        </div>
      </form>

      <nav className="mt-4 flex gap-1 text-sm" aria-label="Result">
        {[["", "All"], ["success", "Successful"], ["failed", "Failed"]].map(([v, l]) => (
          <Link key={v} href={link({ result: v, page: "" })} className={`rounded-md px-2.5 py-1 ${result === v ? "bg-subtle font-medium" : "text-muted hover:text-ink"}`}>{l}</Link>
        ))}
      </nav>

      {error && <p className="mt-4 text-sm text-danger">Could not load login activity. Has migration 0003 been run?</p>}

      <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-card">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3 font-medium">Customer / business</th>
              <th className="px-2 py-3 font-medium">Date &amp; time ↓</th>
              <th className="px-2 py-3 font-medium">Result</th>
              <th className="px-2 py-3 font-medium">IP address</th>
              <th className="px-2 py-3 font-medium">Approx. location</th>
              <th className="px-2 py-3 font-medium">Device</th>
              <th className="px-4 py-3 font-medium">Browser · OS</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => {
              const c = e.customer_id ? nameById.get(e.customer_id) : undefined;
              return (
                <tr key={e.id} className="border-b border-line last:border-0">
                  <td className="max-w-[220px] truncate px-4 py-3">
                    {e.customer_id && c ? (
                      <Link href={`/admin/customers/${e.customer_id}`} className="font-medium hover:underline hover:underline-offset-4">
                        {c.name}{c.deleted ? " (removed)" : ""}
                      </Link>
                    ) : (
                      <span className="text-muted">Unknown (no matching account)</span>
                    )}
                  </td>
                  <td className="tabular whitespace-nowrap px-2 py-3">{formatWhen(e.created_at, tz)}</td>
                  <td className="px-2 py-3"><Result e={e} /></td>
                  <td className="px-2 py-3 font-mono text-xs">{e.ip ?? "Unknown"}</td>
                  <td className="px-2 py-3 text-muted">{location(e)}</td>
                  <td className="px-2 py-3 text-muted">{DEVICE_LABEL[e.device_type] ?? "Unknown"}</td>
                  <td className="px-4 py-3 text-muted">{browserLabel(e)}</td>
                </tr>
              );
            })}
            {events.length === 0 && !error && (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-muted">{filtered ? "No login activity matches these filters." : "No login activity yet."}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-muted">
          <span>Page {page} of {pages} · {count} records</span>
          <div className="flex gap-2">
            {page > 1 && <Link href={link({ page: String(page - 1) })} className={btn.small}>Newer</Link>}
            {page < pages && <Link href={link({ page: String(page + 1) })} className={btn.small}>Older</Link>}
          </div>
        </div>
      )}

      <PurgeLoginEvents />
    </div>
  );
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-card px-4 py-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`tabular mt-1 text-lg font-semibold ${danger ? "text-danger" : ""}`}>{value}</dd>
    </div>
  );
}
