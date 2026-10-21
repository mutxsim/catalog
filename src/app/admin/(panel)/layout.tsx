import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { signOut } from "../login/actions";
import { AdminNav } from "./nav";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · Admin" } };
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requireAdmin();
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Link href="/admin/orders" className="text-sm font-semibold tracking-tight">Admin</Link>
          <AdminNav />
          <div className="ml-auto flex items-center gap-1">
            <Link href="/" target="_blank" className="hidden h-9 items-center rounded-md px-2.5 text-sm text-muted hover:bg-subtle hover:text-ink sm:inline-flex">
              View catalog ↗
            </Link>
            <form action={signOut}>
              <button className="h-9 rounded-md px-2.5 text-sm text-muted hover:bg-subtle hover:text-ink">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
