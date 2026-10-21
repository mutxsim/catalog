import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import type { Quote } from "@/lib/types";

/** Errors raised by the database functions, mapped to customer-friendly responses. */
export const ORDER_ERRORS: Record<string, { status: number; message: string }> = {
  INVALID_BUSINESS_NAME: { status: 422, message: "Enter your store or business name (up to 120 characters)." },
  INVALID_ITEMS: { status: 422, message: "Your cart has an invalid item. Please review it and try again." },
  INVALID_QUANTITY: { status: 422, message: "Quantities must be between 1 and 9,999." },
  ITEMS_UNAVAILABLE: { status: 409, message: "Some items are no longer available. Please review your order." },
  PRICE_CHANGED: { status: 409, message: "Prices have changed since you loaded this page. Please review the updated total." },
  RATE_LIMITED: { status: 429, message: "Too many orders from this connection. Please wait a few minutes and try again." },
  INVALID_REQUEST: { status: 400, message: "Invalid request." },
};

export function mapDbError(message: string | undefined) {
  const code = Object.keys(ORDER_ERRORS).find((k) => message?.includes(k));
  return code ? { code, ...ORDER_ERRORS[code] } : null;
}

export function normaliseQuote(q: Quote): Quote {
  return {
    ...q,
    subtotal_cents: Number(q.subtotal_cents),
    tax_cents: Number(q.tax_cents),
    total_cents: Number(q.total_cents),
    tax_rate: Number(q.tax_rate),
    lines: q.lines.map((l) => ({ ...l, line_total_cents: Number(l.line_total_cents) })),
  };
}

/** Hash of the client IP (never stored raw) used only for rate limiting. */
export function clientHash(headers: Headers) {
  const ip =
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim() || headers.get("cf-connecting-ip")?.trim() || "unknown";
  return createHash("sha256").update(`${env.hashSecret}:${ip}`).digest("hex").slice(0, 32);
}

export function tokensMatch(given: string | null | undefined, expected: string) {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Reject cross-site form posts: the request must come from this site. */
export function isSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") !== "cross-site";
  try {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
