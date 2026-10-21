import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

/** Session-aware client (admin pages and actions). Subject to RLS. */
export async function createSessionClient() {
  const cookieStore = await cookies();
  return createServerClient(env.supabaseUrl, env.supabasePublishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: the proxy refreshes the session instead.
        }
      },
    },
  });
}

/** Anonymous client for public catalog reads. Subject to RLS (published products only). */
export function createPublicClient() {
  return createClient(env.supabaseUrl, env.supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Privileged client. Server-only; used for placing orders, invoices and storage
 * writes after the caller has been authorised. Never import from client code.
 */
export function createServiceClient() {
  return createClient(env.supabaseUrl, env.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
