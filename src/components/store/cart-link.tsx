"use client";

import Link from "next/link";
import { useCartCount } from "@/lib/cart";

export function CartLink() {
  const count = useCartCount();
  return (
    <Link
      href="/cart"
      aria-label={`Cart, ${count} item${count === 1 ? "" : "s"}`}
      className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink transition-colors hover:bg-subtle"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M6 7h12l-1 12.2a1 1 0 0 1-1 .8H8a1 1 0 0 1-1-.8L6 7Z" />
        <path d="M9 7V6a3 3 0 0 1 6 0v1" />
      </svg>
      {count > 0 && (
        <span className="tabular absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-semibold text-white">
          {count > 999 ? "999+" : count}
        </span>
      )}
    </Link>
  );
}
