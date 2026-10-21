"use client";

import { useState } from "react";
import { MAX_QTY } from "@/lib/cart";

export function QtyStepper({
  value,
  onChange,
  label,
  size = "md",
}: {
  value: number;
  onChange: (n: number) => void;
  label: string;
  size?: "sm" | "md";
}) {
  const [draft, setDraft] = useState(String(value));
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    // Keep the text box in step when the quantity changes elsewhere (e.g. +/− buttons).
    setSynced(value);
    setDraft(String(value));
  }
  const h = size === "sm" ? "h-9" : "h-11";
  const w = size === "sm" ? "w-9" : "w-11";

  const commit = (raw: string) => {
    const n = Math.max(1, Math.min(MAX_QTY, parseInt(raw, 10) || 1));
    setDraft(String(n));
    if (n !== value) onChange(n);
  };

  return (
    <div className={`flex ${h} items-center rounded-xl border border-line bg-card`}>
      <button type="button" aria-label={`Decrease ${label}`} disabled={value <= 1} onClick={() => onChange(value - 1)} className={`${w} h-full text-lg text-muted hover:text-ink disabled:opacity-30`}>
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={MAX_QTY}
        aria-label={label}
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, "").slice(0, 4))}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), commit((e.target as HTMLInputElement).value))}
        className="tabular h-full w-10 min-w-0 flex-1 bg-transparent text-center text-[15px] focus:outline-none"
      />
      <button type="button" aria-label={`Increase ${label}`} disabled={value >= MAX_QTY} onClick={() => onChange(value + 1)} className={`${w} h-full text-lg text-muted hover:text-ink disabled:opacity-30`}>
        +
      </button>
    </div>
  );
}
