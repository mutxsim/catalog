import { describe, expect, it } from "vitest";
import { codeHint, generateAccessCode, hashAccessCode, looksLikeAccessCode, normaliseAccessCode } from "@/lib/access-code";
import { approximateLocation, clientIp, parseUserAgent } from "@/lib/request-info";
import { sessionEnd, sessionStatus, zonedDayStart } from "@/lib/activity";

describe("access codes", () => {
  it("are random, well-formed and unambiguous", () => {
    const codes = new Set(Array.from({ length: 2000 }, generateAccessCode));
    expect(codes.size).toBe(2000);
    for (const c of [...codes].slice(0, 50)) {
      expect(c).toMatch(/^[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}$/);
      expect(c).not.toMatch(/[01ILOU]/);
      expect(looksLikeAccessCode(normaliseAccessCode(c))).toBe(true);
    }
  });
  it("hash the same however they're typed, and never equal the code", () => {
    const c = "K7QM-2XTR-9HBD-PW4C";
    expect(hashAccessCode(c)).toBe(hashAccessCode(" k7qm 2xtr 9hbd pw4c "));
    expect(hashAccessCode(c)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashAccessCode(c)).not.toContain("K7QM");
    expect(codeHint(c)).toBe("PW4C");
  });
});

describe("device detection (best effort)", () => {
  it.each([
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1", "mobile", "Safari", "17.4", "iOS"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.6668.90 Safari/537.36", "desktop", "Chrome", "129.0", "Windows"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.2792.79", "desktop", "Edge", "129.0", "Windows"],
    ["Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36", "mobile", "Samsung Internet", "25.0", "Android"],
    ["Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1", "tablet", "Chrome", "129.0", "iOS"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:131.0) Gecko/20100101 Firefox/131.0", "desktop", "Firefox", "131.0", "macOS"],
    ["curl/8.4.0", "unknown", null, null, null],
  ])("%s", (ua, device, browser, version, os) => {
    expect(parseUserAgent(ua)).toEqual({ deviceType: device, browser, browserVersion: version, os });
  });
  it("handles a missing user agent", () => {
    expect(parseUserAgent(null).deviceType).toBe("unknown");
  });
});

describe("IP and location headers", () => {
  it("prefers the platform header, takes the first hop, rejects junk", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }))).toBe("203.0.113.5");
    expect(clientIp(new Headers({ "x-vercel-forwarded-for": "198.51.100.7", "x-forwarded-for": "1.1.1.1" }))).toBe("198.51.100.7");
    expect(clientIp(new Headers({ "x-forwarded-for": "<script>" }))).toBeNull();
    expect(clientIp(new Headers())).toBeNull();
  });
  it("decodes city names and reports unknown as null", () => {
    expect(approximateLocation(new Headers({ "x-vercel-ip-city": "S%C3%A3o%20Paulo", "x-vercel-ip-country": "BR" }))).toEqual({ city: "São Paulo", region: null, country: "BR" });
    expect(approximateLocation(new Headers())).toEqual({ city: null, region: null, country: null });
  });
});

describe("session display", () => {
  const base = { id: "s", created_at: "2026-01-01T00:00:00Z", last_seen_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString(), ended_at: null, end_reason: null };
  it("never claims a logout that didn't happen", () => {
    expect(sessionStatus(base, 7).label).toBe("Active");
    expect(sessionStatus({ ...base, last_seen_at: new Date(Date.now() - 8 * 86400000).toISOString() }, 7).label).toBe("Expired");
    expect(sessionStatus({ ...base, ended_at: base.created_at, end_reason: "logout" }, 7).label).toBe("Logged out");
    expect(sessionStatus({ ...base, ended_at: base.created_at, end_reason: "code_regenerated" }, 7).label).toBe("Ended: code regenerated");
    expect(sessionEnd(base, 7)).toBeNull();
  });
  it("converts a local calendar day to UTC", () => {
    expect(zonedDayStart("2026-07-01", "America/New_York")).toBe("2026-07-01T04:00:00.000Z");
    expect(zonedDayStart("2026-12-01", "America/New_York")).toBe("2026-12-01T05:00:00.000Z");
    expect(zonedDayStart("nope", "UTC")).toBeNull();
  });
});
