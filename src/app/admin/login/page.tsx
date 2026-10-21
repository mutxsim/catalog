import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAdmin } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Admin sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getAdmin()) redirect("/admin/orders");
  return (
    <main className="flex min-h-dvh items-center justify-center px-5">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold tracking-tight">Admin</h1>
        <p className="mt-1 text-sm text-muted">Sign in to manage products and orders.</p>
        <LoginForm />
      </div>
    </main>
  );
}
