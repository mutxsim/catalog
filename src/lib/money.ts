/** Money is always handled as integer minor units (cents). */

const formatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(cents: number | string | bigint, currency = "USD", display: "symbol" | "code" = "symbol"): string {
  const key = `${currency}:${display}`;
  let f = formatters.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: display, minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch {
      f = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    formatters.set(key, f);
  }
  return f.format(Number(cents) / 100);
}

/** Parse "12.5", "$1,234.56", "1234" into cents. Returns null when invalid. */
export function parsePriceToCents(input: string): number | null {
  const cleaned = input.replace(/[\s,$€£]/g, "");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}
