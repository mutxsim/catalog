import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import { hashSessionToken } from "@/lib/access-code";

export const SESSION_COOKIE = "catalog_session";
export const SESSION_DAYS = 30;
export const SESSION_IDLE_DAYS = 7;

export type CustomerSession = { sessionId: string; customerId: string; customerName: string };
type Check = { status: "active"; session: CustomerSession } | { status: "none" | "invalid" | "expired" | "ended" };

/** Validates the session cookie against the database (once per request). */
export const checkCustomerSession = cache(async (): Promise<Check> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[A-Za-z0-9_-]{40,100}$/.test(token)) return { status: "none" };
  const { data, error } = await createServiceClient().rpc("customer_session", {
    p_session_hash: hashSessionToken(token),
    p_idle_days: SESSION_IDLE_DAYS,
  });
  if (error) throw new Error(`Session check failed: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as
    | { status: string; session_id: string; customer_id: string; customer_name: string | null }
    | undefined;
  if (row?.status === "active" && row.customer_name) {
    return { status: "active", session: { sessionId: row.session_id, customerId: row.customer_id, customerName: row.customer_name } };
  }
  return { status: (row?.status as "invalid" | "expired" | "ended") ?? "invalid" };
});

/** For customer pages: redirects to the login screen unless signed in. */
export async function requireCustomer(): Promise<CustomerSession> {
  const check = await checkCustomerSession();
  if (check.status === "active") return check.session;
  redirect(check.status === "expired" ? "/login?reason=expired" : check.status === "ended" ? "/login?reason=ended" : "/login");
}

/** For customer API routes: returns null instead of redirecting. */
export async function customerOrNull(): Promise<CustomerSession | null> {
  const check = await checkCustomerSession();
  return check.status === "active" ? check.session : null;
}

export const unauthorized = () =>
  Response.json({ error: "Your session has ended. Please log in again.", code: "UNAUTHORIZED" }, { status: 401 });
