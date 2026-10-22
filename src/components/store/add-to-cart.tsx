"use client";

import { useEffect, useState } from "react";
import { cart, type CartItem } from "@/lib/cart";
import { QtyStepper } from "./qty-stepper";

export function AddToCart({ item, disabled }: { item: Omit<CartItem, "quantity">; disabled?: boolean }) {
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const label = item.flavorName ? `${item.name} (${item.flavorName})` : item.name;

  useEffect(() => {
    if (!added) return;
    const t = setTimeout(() => setAdded(false), 1400);
    return () => clearTimeout(t);
  }, [added]);

  return (
    <div className="flex gap-3">
      <div className="w-[132px] shrink-0">
        <QtyStepper value={qty} onChange={setQty} label={`quantity of ${label}`} />
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          cart.add(item, qty);
          setAdded(true);
          setQty(1);
        }}
        aria-live="polite"
        className={`h-11 flex-1 whitespace-nowrap rounded-xl px-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          added ? "bg-highlight text-paper" : "bg-cta text-on-cta hover:opacity-90"
        }`}
      >
        {added ? "Added ✓" : "Add to Cart"}
      </button>
    </div>
  );
}
