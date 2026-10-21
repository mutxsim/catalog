"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

const go = (router: ReturnType<typeof useRouter>, q: string, category: string) => {
  const p = new URLSearchParams();
  if (q.trim()) p.set("q", q.trim());
  if (category) p.set("c", category);
  const qs = p.toString();
  router.replace(`/${qs ? `?${qs}` : ""}`, { scroll: false });
};

/**
 * Large search box and category dropdown on the catalog page. Values come from
 * the server, so both render fully on first load (no empty placeholders).
 */
export function CatalogSearch({ query, category, categories }: { query: string; category: string; categories: string[] }) {
  const router = useRouter();
  const [value, setValue] = useState(query);
  const [synced, setSynced] = useState(query);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (synced !== query) {
    setSynced(query);
    setValue(query);
  }

  return (
    <div className={`grid gap-3 ${categories.length ? "sm:grid-cols-[1fr_260px]" : ""}`}>
      <form
        role="search"
        className="relative"
        onSubmit={(e) => {
          e.preventDefault();
          go(router, value, category);
        }}
      >
        <svg className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            setValue(v);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => go(router, v, category), 250);
          }}
          placeholder="Search products"
          aria-label="Search products"
          className="h-14 w-full rounded-2xl border border-line bg-card pl-11 pr-4 text-base placeholder:text-muted focus:border-accent focus:outline-none"
        />
      </form>

      {categories.length > 0 && (
        <div className="relative">
          <select
            aria-label="Categories"
            value={category}
            onChange={(e) => go(router, value, e.target.value)}
            className="h-14 w-full appearance-none rounded-2xl border border-line bg-card pl-4 pr-11 text-base text-ink focus:border-accent focus:outline-none"
          >
            <option value="">All</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <svg className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-muted" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="m7 9 5-5 5 5M7 15l5 5 5-5" />
          </svg>
        </div>
      )}
    </div>
  );
}
