import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { storeTimeZone } from "@/lib/invoice/service";
import { formatWhen } from "@/lib/activity";
import { btn, input } from "@/components/ui";
import { AddCustomer } from "./add-customer";

export const metadata: Metadata = { title: "Customers" };
const PAGE_SIZE = 50;

type Row = { id: string; name: string; active: boolean; code_hint: string | null; created_at: string; last_login_at: string | null };

export default async function CustomersPage({ searchParams }: PageProps<"/admin/customers">) {
  const { supabase } = await requireAdmin();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  const status = sp.status === "active" || sp.status === "inactive" ? sp.status : null;
  const page = Math.max(1, Number(sp.page) || 1);
  const tz = storeTimeZone();

  let query = supabase
    .from("customers")
    .select("id, name, active, code_hint, created_at, last_login_at", { count: "exact" })
    .is("deleted_at", null)
    .order("name")
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (q) query = query.ilike("name", `%${q.replace(/[%_]/g, " ")}%`);
  if (status) query = query.eq("active", status === "active");
  const { data, count, error } = await query;
  const rows = (data ?? []) as Row[];
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const link = (p: number) => `/admin/customers?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}), page: String(p) })}`;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Customers</h1>
      </div>
      {sp.deleted === "1" && <p className="mt-4 rounded-lg bg-subtle px-3 py-2 text-sm">Customer removed. Their past orders and login history are kept.</p>}

      <AddCustomer />

      <form className="mt-6 flex flex-wrap gap-2" role="search">
        <input name="q" defaultValue={q} placeholder="Search customer or business name" className={`${input} h-9 max-w-xs`} />
        <select name="status" defaultValue={status ?? ""} aria-label="Status" className={`${input} h-9 w-36`}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <button className={`${btn.secondary} h-9`}>Search</button>
        {(q || status) && <Link href="/admin/customers" className={btn.ghost}>Clear</Link>}
      </form>

      {error && <p className="mt-4 text-sm text-danger">Could not load customers. Has migration 0003 been run?</p>}

      <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-card">
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3 font-medium">Customer / business</th>
              <th className="px-2 py-3 font-medium">Status</th>
              <th className="px-2 py-3 font-medium">Access code</th>
              <th className="px-2 py-3 font-medium">Created</th>
              <th className="px-2 py-3 font-medium">Last login</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-b border-line last:border-0 hover:bg-paper">
                <td className="max-w-[260px] truncate px-4 py-3 font-medium">
                  <Link href={`/admin/customers/${c.id}`} className="hover:underline hover:underline-offset-4">{c.name}</Link>
                </td>
                <td className="px-2 py-3">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${c.active ? "bg-accent-soft text-accent" : "bg-subtle text-muted"}`}>
                    {c.active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-2 py-3 font-mono text-xs text-muted">{c.code_hint ? `••••-••••-••••-${c.code_hint}` : "—"}</td>
                <td className="tabular whitespace-nowrap px-2 py-3 text-muted">{formatWhen(c.created_at, tz)}</td>
                <td className="tabular whitespace-nowrap px-2 py-3 text-muted">{c.last_login_at ? formatWhen(c.last_login_at, tz) : "Never"}</td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/admin/customers/${c.id}`} className={btn.small}>Manage</Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !error && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-muted">
                  {q || status ? "No customers match." : "No customers yet. Add one above to generate their access code."}
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
            {page > 1 && <Link href={link(page - 1)} className={btn.small}>Previous</Link>}
            {page < pages && <Link href={link(page + 1)} className={btn.small}>Next</Link>}
          </div>
        </div>
      )}
    </div>
  );
}
