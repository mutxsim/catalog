"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { cart, lineKey, type CartItem } from "@/lib/cart";
import type { Quote } from "@/lib/types";

/** Fetches live prices and availability for the cart from the server. */
export function useQuote(items: CartItem[]) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const key = items.map((i) => `${lineKey(i)}:${i.quantity}`).join("|");
  const router = useRouter();

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    if (!key) {
      setQuote(null);
      return null;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // key = "productId:flavorId:qty|…" — rebuild the request from it.
        body: JSON.stringify({
          items: key.split("|").map((part) => {
            const [productId, flavorId, qty] = part.split(":");
            return { productId, flavorId: flavorId || null, quantity: Number(qty) };
          }),
        }),
      });
      if (res.status === 401) {
        router.replace("/login?reason=ended");
        return null;
      }
      const body = (await res.json()) as { quote?: Quote | null; error?: string };
      if (mine !== seq.current) return null;
      if (!res.ok) throw new Error(body.error ?? "Could not update prices.");
      setError(null);
      setQuote(body.quote ?? null);
      if (body.quote) cart.sync(body.quote.lines);
      return body.quote ?? null;
    } catch (e) {
      if (mine === seq.current) setError((e as Error).message || "Could not update prices.");
      return null;
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [key, router]);

  useEffect(() => {
    const t = setTimeout(refresh, 200);
    return () => clearTimeout(t);
  }, [refresh]);

  return { quote, loading, error, refresh };
}

/** Lines the server could not price, keyed like cart lines, with the reason. */
export function unavailableMap(quote: Quote | null) {
  return new Map((quote?.unavailable ?? []).map((u) => [lineKey({ productId: u.product_id, flavorId: u.flavor_id }), u.reason]));
}

export const UNAVAILABLE_TEXT = {
  unavailable: "No longer available",
  flavor_required: "Choose a flavor — remove and add again",
  flavor_unavailable: "This flavor is no longer available",
} as const;
