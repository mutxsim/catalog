"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore } from "react";
import { cart, cartSignature, useCart, type CartItem } from "@/lib/cart";
import { formatMoney } from "@/lib/money";
import { btn, input, label } from "@/components/ui";
import { useQuote } from "@/components/store/use-quote";
import { Totals } from "@/components/store/totals";

const useHydrated = () => useSyncExternalStore(() => () => {}, () => true, () => false);
const KEY_STORE = "catalog.checkout.key";

/**
 * One submission key per cart: retries, double-clicks and refreshes reuse it,
 * so the server creates the order at most once.
 */
function submissionKey(items: CartItem[]) {
  const sig = cartSignature(items);
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY_STORE) ?? "null") as { sig: string; key: string } | null;
    if (saved?.sig === sig) return saved.key;
    const key = crypto.randomUUID();
    sessionStorage.setItem(KEY_STORE, JSON.stringify({ sig, key }));
    return key;
  } catch {
    return crypto.randomUUID();
  }
}

export function CheckoutView({ currency }: { currency: string }) {
  const router = useRouter();
  const items = useCart();
  const hydrated = useHydrated();
  const { quote, loading, error: quoteError, refresh } = useQuote(items);
  const [businessName, setBusinessName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const m = (c: number) => formatMoney(c, quote?.currency ?? currency);

  if (!hydrated) return <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6" />;

  if (items.length === 0 && !submitting) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-24 text-center sm:px-6">
        <h1 className="text-xl font-semibold tracking-tight">Your cart is empty</h1>
        <Link href="/" className={`${btn.primary} mt-6`}>Browse catalog</Link>
      </main>
    );
  }

  const unavailable = (quote?.unavailable.length ?? 0) > 0;
  const canSubmit = !!quote && !loading && !unavailable && businessName.trim().length > 0 && !submitting;

  async function placeOrder(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current || !quote) return;
    const name = businessName.trim();
    if (!name) {
      setError("Enter your store or business name.");
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: name,
          items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
          expectedTotalCents: quote.total_cents,
          idempotencyKey: submissionKey(items),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { orderId?: string; token?: string; error?: string; code?: string };
      if (!res.ok || !body.orderId || !body.token) {
        if (body.code === "PRICE_CHANGED" || body.code === "ITEMS_UNAVAILABLE") await refresh();
        throw new Error(body.error ?? "We couldn't place your order. Please try again.");
      }
      router.replace(`/order/${body.orderId}?t=${encodeURIComponent(body.token)}`);
      cart.clear();
      try {
        sessionStorage.removeItem(KEY_STORE);
      } catch {}
    } catch (err) {
      setError(
        err instanceof TypeError
          ? "Connection problem — your order may not have been sent. Press Place Order again; you won't be charged twice."
          : (err as Error).message,
      );
      setSubmitting(false);
      inFlight.current = false;
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 pb-10 pt-5 sm:px-6 sm:pt-8">
      <Link href="/cart" className="text-sm text-muted hover:text-ink">← Back to cart</Link>
      <h1 className="mt-2 text-xl font-semibold tracking-tight">Checkout</h1>

      <form onSubmit={placeOrder} className="mt-6" noValidate>
        <label htmlFor="business" className={label}>Store / Business Name</label>
        <input
          id="business"
          name="business"
          required
          maxLength={120}
          autoComplete="organization"
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          className={input}
          placeholder="e.g. Main Street Market"
        />

        <section aria-label="Order summary" className="mt-8">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted">Order summary</h2>
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {(quote?.lines ?? []).map((l) => (
              <li key={l.product_id} className="flex justify-between gap-4 py-3 text-[15px]">
                <div className="min-w-0">
                  <p className="leading-snug">{l.name}</p>
                  <p className="tabular mt-0.5 text-sm text-muted">
                    {l.sku ? `${l.sku} · ` : ""}
                    {l.quantity} × {m(l.unit_price_cents)}
                  </p>
                </div>
                <p className="tabular shrink-0">{m(l.line_total_cents)}</p>
              </li>
            ))}
            {!quote && (
              <li className="py-6 text-center text-sm text-muted">{quoteError ?? "Loading current prices…"}</li>
            )}
          </ul>
          {unavailable && (
            <p className="mt-3 text-sm text-danger">
              Some items in your cart are no longer available. <Link href="/cart" className="underline underline-offset-4">Review cart</Link>
            </p>
          )}
          <div className="mt-4">
            <Totals quote={quote} fallbackSubtotal={0} currency={currency} loading={loading} />
          </div>
        </section>

        <p className="mt-6 rounded-lg bg-subtle px-4 py-3 text-sm text-ink/80">
          Payment is due in-store at pickup. Submitting this order does not require online payment.
        </p>

        {error && (
          <p role="alert" className="mt-4 text-sm text-danger">
            {error}
          </p>
        )}

        <button type="submit" disabled={!canSubmit} className={`${btn.primary} mt-5 h-12 w-full text-[15px]`}>
          {submitting ? "Placing order…" : "Place Order"}
        </button>
      </form>
    </main>
  );
}
