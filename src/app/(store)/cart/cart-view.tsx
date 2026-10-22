"use client";

import Image from "next/image";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { cart, lineKey, useCart } from "@/lib/cart";
import { formatMoney } from "@/lib/money";
import { publicStorageUrl } from "@/lib/public-url";
import { btn } from "@/components/ui";
import { QtyStepper } from "@/components/store/qty-stepper";
import { UNAVAILABLE_TEXT, unavailableMap, useQuote } from "@/components/store/use-quote";
import { Totals } from "@/components/store/totals";

const useHydrated = () => useSyncExternalStore(() => () => {}, () => true, () => false);

export function CartView({ currency }: { currency: string }) {
  const items = useCart();
  const hydrated = useHydrated();
  const { quote, loading, error } = useQuote(items);
  const unavailable = unavailableMap(quote);
  const money = (c: number) => formatMoney(c, quote?.currency ?? currency);

  if (!hydrated) return <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6" />;

  if (items.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-24 text-center sm:px-6">
        <h1 className="text-xl font-semibold tracking-tight">Your cart is empty</h1>
        <Link href="/" className={`${btn.primary} mt-6`}>Browse catalog</Link>
      </main>
    );
  }

  const estimatedSubtotal = items.filter((i) => !unavailable.has(lineKey(i))).reduce((s, i) => s + i.priceCents * i.quantity, 0);

  return (
    <main className="mx-auto max-w-3xl px-4 pb-10 pt-5 sm:px-6 sm:pt-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Cart</h1>
        <Link href="/" className="text-sm text-muted hover:text-ink">Continue shopping</Link>
      </div>

      <ul className="mt-5 divide-y divide-line border-y border-line">
        {items.map((i) => {
          const img = publicStorageUrl("product-images", i.imagePath);
          const key = lineKey(i);
          const reason = unavailable.get(key);
          const gone = Boolean(reason);
          return (
            <li key={key} className="flex gap-3 py-4 sm:gap-4">
              <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-subtle">
                {img && <Image src={img} alt="" fill sizes="80px" className={`object-cover ${gone ? "opacity-40" : ""}`} />}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex justify-between gap-3">
                  <div className="min-w-0">
                    <p className={`line-clamp-2 text-[15px] font-medium leading-snug ${gone ? "text-muted line-through" : ""}`}>{i.name}</p>
                    {i.flavorName && <p className="mt-0.5 text-sm font-medium text-highlight">Flavor: {i.flavorName}</p>}
                    <p className="tabular mt-0.5 text-sm text-muted">
                      {i.sku ? `${i.sku} · ` : ""}
                      {money(i.priceCents)} each
                    </p>
                  </div>
                  <p className="tabular shrink-0 text-[15px]">{gone ? "—" : money(i.priceCents * i.quantity)}</p>
                </div>
                {gone ? (
                  <div className="mt-2 flex items-center gap-3">
                    <p className="text-sm text-danger">{UNAVAILABLE_TEXT[reason!]}</p>
                    <button onClick={() => cart.remove(key)} className="text-sm underline underline-offset-4">Remove</button>
                  </div>
                ) : (
                  <div className="mt-2.5 flex items-center gap-3">
                    <div className="w-[120px]">
                      <QtyStepper size="sm" value={i.quantity} onChange={(n) => cart.setQuantity(key, n)} label={`quantity of ${i.name}${i.flavorName ? ` (${i.flavorName})` : ""}`} />
                    </div>
                    <button onClick={() => cart.remove(key)} className="text-sm text-muted hover:text-ink">Remove</button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-6 sm:ml-auto sm:max-w-xs">
        <Totals
          quote={quote}
          fallbackSubtotal={estimatedSubtotal}
          currency={currency}
          loading={loading}
          totalLabel="Estimated total"
        />
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        <Link
          href="/checkout"
          aria-disabled={unavailable.size > 0}
          className={`${btn.primary} mt-5 w-full ${unavailable.size > 0 ? "pointer-events-none opacity-40" : ""}`}
        >
          Checkout
        </Link>
        <p className="mt-3 text-center text-xs text-muted">Pay in-store at pickup. No online payment.</p>
      </div>
    </main>
  );
}
