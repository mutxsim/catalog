"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin/orders", label: "Orders" },
  { href: "/admin/products", label: "Products" },
  { href: "/admin/settings", label: "Settings" },
] as const;

export function AdminNav() {
  const path = usePathname();
  return (
    <nav className="flex items-center gap-0.5">
      {LINKS.map((l) => {
        const active = path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`h-9 rounded-md px-2.5 text-sm leading-9 transition-colors ${active ? "bg-subtle font-medium text-ink" : "text-muted hover:text-ink"}`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
