"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

/** Header search: searches every catalog. Hidden where the page has its own large search box. */
export function SearchBox() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const urlQ = pathname === "/search" ? (params.get("q") ?? "") : "";
  const [value, setValue] = useState(urlQ);
  const [syncedQ, setSyncedQ] = useState(urlQ);
  if (syncedQ !== urlQ) {
    // URL changed (e.g. back button): reflect it in the box.
    setSyncedQ(urlQ);
    setValue(urlQ);
  }

  if (pathname === "/search" || pathname.startsWith("/shop/")) return null;

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const q = value.trim();
        router.push(q ? `/search?${new URLSearchParams({ q })}` : "/search");
      }}
      className="relative"
    >
      <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search all products"
        aria-label="Search all products"
        className="h-10 w-full rounded-full border border-line bg-card pl-9 pr-4 text-[15px] placeholder:text-muted/70 focus:border-accent focus:outline-none"
      />
    </form>
  );
}
