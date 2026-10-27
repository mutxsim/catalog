"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type Filters = { q: string; brand: string; category: string };

function hrefFor(basePath: string, f: Filters) {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.brand) p.set("b", f.brand);
  if (f.category) p.set("c", f.category);
  const qs = p.toString();
  return `${basePath}${qs ? `?${qs}` : ""}`;
}

const COLLAPSED = 12;

function ChipRow({ label, options, value, onPick }: { label: string; options: string[]; value: string; onPick: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  if (options.length === 0) return null;
  // Long lists (brands) show the first few until "More" is pressed; the picked one always shows.
  const long = options.length > COLLAPSED + 2;
  let shown = options;
  if (long && !open) {
    shown = options.slice(0, COLLAPSED);
    if (value && !shown.includes(value)) shown = [value, ...shown.slice(0, COLLAPSED - 1)];
  }
  const chip = (active: boolean) =>
    `inline-flex h-9 items-center whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition-colors ${
      active ? "border-accent bg-accent-soft text-accent" : "border-line bg-card text-muted hover:border-accent hover:text-ink"
    }`;
  return (
    <div role="group" aria-label={label} className="grid gap-2 sm:grid-cols-[5.5rem_1fr] sm:items-start">
      <span className="pt-0 text-xs font-semibold uppercase tracking-[0.18em] text-muted sm:pt-2.5">{label}</span>
      <div className="flex min-w-0 flex-wrap gap-2">
        <button type="button" aria-pressed={value === ""} onClick={() => onPick("")} className={chip(value === "")}>All</button>
        {shown.map((o) => (
          <button key={o} type="button" aria-pressed={value === o} onClick={() => onPick(value === o ? "" : o)} className={`${chip(value === o)} max-w-full`}>
            <span className="truncate">{o}</span>
          </button>
        ))}
        {long && (
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="inline-flex h-9 items-center px-2 text-sm font-medium text-accent underline-offset-4 hover:underline">
            {open ? "Show less" : `+ ${options.length - shown.length} more`}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Search box plus Brand and Category filter rows at the top of a catalog.
 * Values come from the server, so everything renders fully on first load.
 */
export function CatalogSearch({
  basePath,
  query,
  brand,
  category,
  brands,
  categories,
}: {
  basePath: string;
  query: string;
  brand: string;
  category: string;
  brands: string[];
  categories: string[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(query);
  const [synced, setSynced] = useState(query);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (synced !== query) {
    setSynced(query);
    setValue(query);
  }
  const go = (f: Filters) => router.replace(hrefFor(basePath, f), { scroll: false });

  return (
    <div className="space-y-4">
      {(brands.length > 0 || categories.length > 0) && (
        <div className="space-y-3 rounded-3xl border border-line bg-card/60 p-4">
          <ChipRow label="Brands" options={brands} value={brand} onPick={(b) => go({ q: value, brand: b, category })} />
          <ChipRow label="Items" options={categories} value={category} onPick={(c) => go({ q: value, brand, category: c })} />
        </div>
      )}

      <form
        role="search"
        className="relative"
        onSubmit={(e) => {
          e.preventDefault();
          if (timer.current) clearTimeout(timer.current);
          go({ q: value, brand, category });
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
            timer.current = setTimeout(() => go({ q: v, brand, category }), 250);
          }}
          placeholder="Search products"
          aria-label="Search products"
          className="h-14 w-full rounded-2xl border border-line bg-card pl-11 pr-4 text-base placeholder:text-muted focus:border-accent focus:outline-none"
        />
      </form>
    </div>
  );
}
