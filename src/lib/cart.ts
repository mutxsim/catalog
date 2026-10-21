"use client";

import { useSyncExternalStore } from "react";

/** Cart lives only in this browser (localStorage). Prices here are display-only; the server re-prices every order. */
export type CartItem = {
  productId: string;
  name: string;
  priceCents: number;
  sku: string | null;
  imagePath: string | null;
  quantity: number;
};

const KEY = "catalog.cart.v1";
export const MAX_QTY = 9999;
const EMPTY: CartItem[] = [];

let cache: CartItem[] | null = null;
const listeners = new Set<() => void>();

function read(): CartItem[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    cache = Array.isArray(parsed)
      ? parsed.filter(
          (i): i is CartItem =>
            i && typeof i.productId === "string" && Number.isInteger(i.quantity) && i.quantity > 0 && typeof i.name === "string",
        )
      : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(items: CartItem[]) {
  cache = items;
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Storage full or blocked: the cart still works for this page view.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = null;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const clamp = (q: number) => Math.max(1, Math.min(MAX_QTY, Math.floor(q) || 1));

export const cart = {
  add(item: Omit<CartItem, "quantity">, quantity: number) {
    const items = read();
    const existing = items.find((i) => i.productId === item.productId);
    write(
      existing
        ? items.map((i) => (i.productId === item.productId ? { ...i, ...item, quantity: clamp(i.quantity + quantity) } : i))
        : [...items, { ...item, quantity: clamp(quantity) }],
    );
  },
  setQuantity(productId: string, quantity: number) {
    write(read().map((i) => (i.productId === productId ? { ...i, quantity: clamp(quantity) } : i)));
  },
  remove(productId: string) {
    write(read().filter((i) => i.productId !== productId));
  },
  /** Refresh names/prices from a server quote so the cart shows current values. */
  sync(lines: { product_id: string; name: string; sku: string | null; image_path: string | null; unit_price_cents: number }[]) {
    const byId = new Map(lines.map((l) => [l.product_id, l]));
    let changed = false;
    const next = read().map((i) => {
      const l = byId.get(i.productId);
      if (!l) return i;
      if (l.name !== i.name || l.unit_price_cents !== i.priceCents || l.sku !== i.sku || l.image_path !== i.imagePath) {
        changed = true;
        return { ...i, name: l.name, priceCents: l.unit_price_cents, sku: l.sku, imagePath: l.image_path };
      }
      return i;
    });
    if (changed) write(next);
  },
  clear() {
    write([]);
  },
};

export function useCart(): CartItem[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

export function useCartCount(): number {
  return useCart().reduce((n, i) => n + i.quantity, 0);
}

/** A stable signature of cart contents, used to scope the duplicate-submission key. */
export function cartSignature(items: CartItem[]) {
  return items
    .map((i) => `${i.productId}:${i.quantity}`)
    .sort()
    .join("|");
}
