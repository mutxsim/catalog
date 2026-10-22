"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin/orders", label: "Orders" },
  { href: "/admin/products", label: "Products" },
  { href: "/admin/customers", label: "Customers" },
  { href: "/admin/activity", label: "Login Activity" },
  { href: "/admin/settings", label: "Settings" },
] as const;

export function AdminNav() {
  const path = usePathname();
  return (
    <nav className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
      {LINKS.map((l) => {
        const active = path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`h-9 shrink-0 whitespace-nowrap rounded-md px-2.5 text-sm leading-9 transition-colors ${active ? "bg-subtle font-medium text-ink" : "text-muted hover:text-ink"}`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
