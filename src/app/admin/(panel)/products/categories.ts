import "server-only";
import { requireAdmin } from "@/lib/auth";

export async function getCategories() {
  const { supabase } = await requireAdmin();
  const { data } = await supabase.from("products").select("category").not("category", "is", null);
  return [...new Set((data ?? []).map((r) => r.category as string))].sort((a, b) => a.localeCompare(b));
}

export async function getGroups() {
  const { supabase } = await requireAdmin();
  const { data } = await supabase.from("products").select("group_name").not("group_name", "is", null);
  return [...new Set((data ?? []).map((r) => r.group_name as string))].sort((a, b) => a.localeCompare(b));
}
