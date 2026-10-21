import { formatMoney } from "@/lib/money";
import type { Quote } from "@/lib/types";

export function Totals({
  quote,
  fallbackSubtotal,
  currency,
  loading,
  totalLabel = "Total due in-store",
}: {
  quote: Quote | null;
  fallbackSubtotal: number;
  currency: string;
  loading?: boolean;
  totalLabel?: string;
}) {
  const m = (c: number) => formatMoney(c, quote?.currency ?? currency);
  const subtotal = quote?.subtotal_cents ?? fallbackSubtotal;
  return (
    <dl className={`tabular space-y-2 text-[15px] transition-opacity ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
      <div className="flex justify-between">
        <dt className="text-muted">Subtotal</dt>
        <dd>{m(subtotal)}</dd>
      </div>
      {quote?.tax_enabled && (
        <div className="flex justify-between">
          <dt className="text-muted">
            {quote.tax_label} ({quote.tax_rate}%)
          </dt>
          <dd>{m(quote.tax_cents)}</dd>
        </div>
      )}
      <div className="flex justify-between border-t border-line pt-3 text-base font-semibold">
        <dt>{totalLabel}</dt>
        <dd>{quote ? m(quote.total_cents) : m(subtotal)}</dd>
      </div>
    </dl>
  );
}
