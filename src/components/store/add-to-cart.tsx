"use client";

import { useEffect, useState } from "react";
import { cart, type CartItem } from "@/lib/cart";
import { QtyStepper } from "./qty-stepper";

export function AddToCart({ item, compact }: { item: Omit<CartItem, "quantity">; compact?: boolean }) {
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    if (!added) return;
    const t = setTimeout(() => setAdded(false), 1400);
    return () => clearTimeout(t);
  }, [added]);

  return (
    <div className={compact ? "flex flex-col gap-2 sm:flex-row" : "flex gap-3"}>
      <div className={compact ? "sm:w-[108px] sm:shrink-0" : "w-36 shrink-0"}>
        <QtyStepper value={qty} onChange={setQty} label={`quantity of ${item.name}`} size={compact ? "sm" : "md"} />
      </div>
      <button
        type="button"
        onClick={() => {
          cart.add(item, qty);
          setAdded(true);
          setQty(1);
        }}
        aria-live="polite"
        className={`${compact ? "h-9 w-full shrink-0 text-[13px] sm:w-auto sm:flex-1" : "h-11 flex-1 text-sm"} whitespace-nowrap rounded-lg px-3 font-medium transition-colors ${
          added ? "bg-accent text-white" : "bg-ink text-white hover:bg-black"
        }`}
      >
        {added ? "Added ✓" : "Add to Cart"}
      </button>
    </div>
  );
}
