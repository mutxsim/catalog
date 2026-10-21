"use server";

import { redirect } from "next/navigation";
import { createSessionClient } from "@/lib/supabase/server";

export async function signIn(_prev: unknown, formData: FormData): Promise<{ error: string } | null> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };

  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { error: "Incorrect email or password." };

  const { data: admin } = await supabase.from("admins").select("user_id").eq("user_id", data.user.id).maybeSingle();
  if (!admin) {
    await supabase.auth.signOut();
    return { error: "This account doesn't have admin access." };
  }
  redirect("/admin/orders");
}

export async function signOut() {
  const supabase = await createSessionClient();
  await supabase.auth.signOut();
  redirect("/admin/login");
}
