"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";

export async function purgeLoginEvents(): Promise<string> {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.rpc("purge_old_login_events");
  if (error) return "Couldn't remove old records.";
  revalidatePath("/admin/activity");
  const n = Number(data ?? 0);
  return n ? `Removed ${n} old login record${n === 1 ? "" : "s"}.` : "Nothing to remove.";
}
