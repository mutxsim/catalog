import "server-only";
import { redirect } from "next/navigation";
import { createSessionClient } from "@/lib/supabase/server";

/** Returns the admin user or null. Verifies the session with Supabase Auth. */
export async function getAdmin() {
  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const { data: row } = await supabase.from("admins").select("user_id").eq("user_id", data.user.id).maybeSingle();
  if (!row) return null;
  return { user: data.user, supabase };
}

/** Use at the top of every admin page, action and route. */
export async function requireAdmin() {
  const admin = await getAdmin();
  if (!admin) redirect("/admin/login");
  return admin;
}

/** For route handlers: returns null instead of redirecting. */
export async function adminOrNull() {
  return getAdmin();
}
