"use client";

import { useSyncExternalStore } from "react";

/**
 * Cart lives only in this browser (localStorage). Prices here are display-only;
 * the server re-prices every order. The same product in two flavors is two lines.
 */
export type CartItem = {
  productId: string;
  flavorId: string | null;
  name: string;
  flavorName: string | null;
  priceCents: number;
  sku: string | null;
  imagePath: string | null;
  quantity: number;
};

const KEY = "catalog.cart.v2";
const OLD_KEY = "catalog.cart.v1";
export const MAX_QTY = 9999;
const EMPTY: CartItem[] = [];

export const lineKey = (i: { productId: string; flavorId: string | null }) => `${i.productId}:${i.flavorId ?? ""}`;

let cache: CartItem[] | null = null;
const listeners = new Set<() => void>();

function sanitize(raw: unknown): CartItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((i) => i && typeof i.productId === "string" && Number.isInteger(i.quantity) && i.quantity > 0 && typeof i.name === "string")
    .map((i) => ({
      productId: i.productId,
      flavorId: typeof i.flavorId === "string" ? i.flavorId : null,
      name: i.name,
      flavorName: typeof i.flavorName === "string" ? i.flavorName : null,
      priceCents: Number(i.priceCents) || 0,
      sku: typeof i.sku === "string" ? i.sku : null,
      imagePath: typeof i.imagePath === "string" ? i.imagePath : null,
      quantity: i.quantity,
    }));
}

function read(): CartItem[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY);
    cache = sanitize(raw ? JSON.parse(raw) : []);
  } catch {
    cache = [];
  }
  return cache;
}

function write(items: CartItem[]) {
  cache = items;
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
    localStorage.removeItem(OLD_KEY);
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
    const key = lineKey(item);
    const existing = items.find((i) => lineKey(i) === key);
    write(
      existing
        ? items.map((i) => (lineKey(i) === key ? { ...i, ...item, quantity: clamp(i.quantity + quantity) } : i))
        : [...items, { ...item, quantity: clamp(quantity) }],
    );
  },
  setQuantity(key: string, quantity: number) {
    write(read().map((i) => (lineKey(i) === key ? { ...i, quantity: clamp(quantity) } : i)));
  },
  remove(key: string) {
    write(read().filter((i) => lineKey(i) !== key));
  },
  /** Refresh names/prices/images from a server quote so the cart shows current values. */
  sync(lines: { product_id: string; flavor_id: string | null; name: string; flavor_name: string | null; sku: string | null; image_path: string | null; unit_price_cents: number }[]) {
    const byKey = new Map(lines.map((l) => [lineKey({ productId: l.product_id, flavorId: l.flavor_id }), l]));
    let changed = false;
    const next = read().map((i) => {
      const l = byKey.get(lineKey(i));
      if (!l) return i;
      if (l.name !== i.name || l.flavor_name !== i.flavorName || l.unit_price_cents !== i.priceCents || l.sku !== i.sku || l.image_path !== i.imagePath) {
        changed = true;
        return { ...i, name: l.name, flavorName: l.flavor_name, priceCents: l.unit_price_cents, sku: l.sku, imagePath: l.image_path };
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
    .map((i) => `${lineKey(i)}:${i.quantity}`)
    .sort()
    .join("|");
}

export const toRequestItems = (items: CartItem[]) =>
  items.map((i) => ({ productId: i.productId, flavorId: i.flavorId, quantity: i.quantity }));
