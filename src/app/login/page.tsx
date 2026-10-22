import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { checkCustomerSession } from "@/lib/customer-auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Log in", robots: { index: false } };
export const viewport: Viewport = { themeColor: "#0d0c13", colorScheme: "dark" };
export const dynamic = "force-dynamic";

const NOTICES: Record<string, string> = {
  expired: "Your session expired. Enter your access code to continue.",
  ended: "Your session has ended. Enter your access code to continue.",
  logout: "You've been logged out.",
};

export default async function CustomerLoginPage({ searchParams }: PageProps<"/login">) {
  if ((await checkCustomerSession()).status === "active") redirect("/");
  const reason = (await searchParams).reason;
  const notice = typeof reason === "string" ? NOTICES[reason] : undefined;

  return (
    <main className="store-theme store-hero flex min-h-dvh items-center justify-center px-5">
      <div className="w-full max-w-sm">
        <p className="text-center text-sm font-bold uppercase tracking-[0.4em] text-highlight">Catalog</p>
        <div className="mt-6 rounded-3xl border border-line bg-card p-6">
          {notice && <p className="mb-4 rounded-xl bg-subtle px-3 py-2.5 text-sm text-ink/85">{notice}</p>}
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
