"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";

/** Search as you type on the catalog; submits to the catalog from other pages. */
export function SearchBox() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const urlQ = params.get("q") ?? "";
  const [value, setValue] = useState(urlQ);
  const [syncedQ, setSyncedQ] = useState(urlQ);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (syncedQ !== urlQ) {
    // URL changed (e.g. back button or category link): reflect it in the box.
    setSyncedQ(urlQ);
    setValue(urlQ);
  }

  const go = (q: string) => {
    const next = new URLSearchParams(pathname === "/" ? params.toString() : "");
    if (q.trim()) next.set("q", q.trim());
    else next.delete("q");
    const qs = next.toString();
    router.replace(`/${qs ? `?${qs}` : ""}`, { scroll: false });
  };

  // The catalog page has its own large search box; the header one is for other pages.
  if (pathname === "/") return null;

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        go(value);
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
        onChange={(e) => {
          setValue(e.target.value);
          if (pathname === "/") {
            if (timer.current) clearTimeout(timer.current);
            const v = e.target.value;
            timer.current = setTimeout(() => go(v), 250);
          }
        }}
        placeholder="Search products"
        aria-label="Search products"
        className="h-10 w-full rounded-full border border-line bg-card pl-9 pr-4 text-[15px] placeholder:text-muted/70 focus:border-accent focus:outline-none"
      />
    </form>
  );
}
