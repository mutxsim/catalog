/** Display helpers for customer sessions and login records. */

export type LoginEvent = {
  id: string;
  created_at: string;
  customer_id: string | null;
  session_id: string | null;
  success: boolean;
  failure_reason: string | null;
  rate_limited: boolean;
  ip: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  device_type: string;
  browser: string | null;
  browser_version: string | null;
  os: string | null;
};

export type SessionRow = {
  id: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  ended_at: string | null;
  end_reason: string | null;
};

export const EVENT_COLUMNS =
  "id, created_at, customer_id, session_id, success, failure_reason, rate_limited, ip, city, region, country, device_type, browser, browser_version, os";

export const FAILURE_LABEL: Record<string, string> = {
  invalid_code: "Invalid code",
  revoked_code: "Revoked code",
  inactive_account: "Inactive account",
  deleted_account: "Deleted account",
  rate_limited: "Rate limited",
};

export function location(e: Pick<LoginEvent, "city" | "region" | "country">) {
  const parts = [e.city, e.region, e.country].filter(Boolean);
  return parts.length ? parts.join(", ") : "Unknown";
}

export function browserLabel(e: Pick<LoginEvent, "browser" | "browser_version" | "os">) {
  const b = e.browser ? `${e.browser}${e.browser_version ? ` ${e.browser_version}` : ""}` : "Unknown browser";
  return `${b} · ${e.os ?? "Unknown OS"}`;
}

export const DEVICE_LABEL: Record<string, string> = { desktop: "Desktop", mobile: "Mobile", tablet: "Tablet", unknown: "Unknown" };

/** Never claims a logout that didn't happen: lapsed sessions show as expired. */
export function sessionStatus(s: SessionRow | undefined, idleDays: number, now = Date.now()): { label: string; tone: "active" | "ended" | "muted" } {
  if (!s) return { label: "—", tone: "muted" };
  if (s.ended_at) {
    const label =
      s.end_reason === "logout" ? "Logged out"
      : s.end_reason === "expired" ? "Expired"
      : s.end_reason === "deactivated" ? "Ended: account deactivated"
      : s.end_reason === "code_regenerated" ? "Ended: code regenerated"
      : s.end_reason === "deleted" ? "Ended: account removed"
      : "Ended";
    return { label, tone: "ended" };
  }
  const lapsed = new Date(s.expires_at).getTime() <= now || new Date(s.last_seen_at).getTime() <= now - idleDays * 86400000;
  return lapsed ? { label: "Expired", tone: "ended" } : { label: "Active", tone: "active" };
}

export function sessionEnd(s: SessionRow | undefined, idleDays: number): string | null {
  if (!s) return null;
  if (s.ended_at) return s.ended_at;
  const idleEnd = new Date(s.last_seen_at).getTime() + idleDays * 86400000;
  const end = Math.min(new Date(s.expires_at).getTime(), idleEnd);
  return end <= Date.now() ? new Date(end).toISOString() : null;
}

/** Start of a calendar day (YYYY-MM-DD) in a time zone, as a UTC ISO string. */
export function zonedDayStart(day: string, timeZone: string): string | null {
  const m = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const utcGuess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcGuess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asLocal = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return new Date(utcGuess - (asLocal - utcGuess)).toISOString();
}

export function formatWhen(iso: string | null | undefined, timeZone: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone });
}
