"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CATALOG_LABEL } from "@/lib/types";

/** Vapes / Happy links in the store header; the current catalog is highlighted. */
export function CatalogSwitch() {
  const pathname = usePathname();
  return (
    <nav aria-label="Catalogs" className="flex shrink-0 items-center gap-1 rounded-full border border-line bg-card p-1">
      {(["vapes", "happy"] as const).map((c) => {
        const active = pathname === `/shop/${c}`;
        return (
          <Link
            key={c}
            href={`/shop/${c}`}
            aria-current={active ? "page" : undefined}
            className={`inline-flex h-8 items-center rounded-full px-2 text-sm sm:px-3 font-semibold transition-colors ${active ? "bg-accent-soft text-accent" : "text-muted hover:text-ink"}`}
          >
            {CATALOG_LABEL[c]}
          </Link>
        );
      })}
    </nav>
  );
}
