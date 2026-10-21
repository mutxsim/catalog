"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cart, type CartItem } from "@/lib/cart";
import type { Quote } from "@/lib/types";

/** Fetches live prices and availability for the cart from the server. */
export function useQuote(items: CartItem[]) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const key = items.map((i) => `${i.productId}:${i.quantity}`).join("|");

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
        body: JSON.stringify({ items: key.split("|").map((p) => ({ productId: p.split(":")[0], quantity: Number(p.split(":")[1]) })) }),
      });
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
  }, [key]);

  useEffect(() => {
    const t = setTimeout(refresh, 200);
    return () => clearTimeout(t);
  }, [refresh]);

  return { quote, loading, error, refresh };
}
