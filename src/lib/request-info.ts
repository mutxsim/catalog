/**
 * Best-effort connection details for login records. Nothing here is a
 * guaranteed identity: IPs can be VPNs or carrier gateways, user agents can lie.
 */

export type DeviceInfo = {
  deviceType: "desktop" | "mobile" | "tablet" | "unknown";
  browser: string | null;
  browserVersion: string | null;
  os: string | null;
};

export function parseUserAgent(ua: string | null | undefined): DeviceInfo {
  if (!ua) return { deviceType: "unknown", browser: null, browserVersion: null, os: null };

  const os =
    /Windows NT/i.test(ua) ? "Windows"
    : /iPhone|iPad|iPod/i.test(ua) ? "iOS"
    : /Android/i.test(ua) ? "Android"
    : /CrOS/i.test(ua) ? "ChromeOS"
    : /Mac OS X|Macintosh/i.test(ua) ? "macOS"
    : /Linux/i.test(ua) ? "Linux"
    : null;

  const match = (re: RegExp) => ua.match(re)?.[1] ?? null;
  let browser: string | null = null;
  let browserVersion: string | null = null;
  const pick = (name: string, re: RegExp) => {
    if (browser) return;
    const v = match(re);
    if (v !== null) {
      browser = name;
      browserVersion = v;
    }
  };
  // Order matters: many browsers include "Chrome" and "Safari" in their UA.
  pick("Edge", /Edg(?:e|A|iOS)?\/([\d.]+)/);
  pick("Opera", /(?:OPR|Opera)\/([\d.]+)/);
  pick("Samsung Internet", /SamsungBrowser\/([\d.]+)/);
  pick("Firefox", /(?:Firefox|FxiOS)\/([\d.]+)/);
  pick("Chrome", /(?:Chrome|CriOS)\/([\d.]+)/);
  if (!browser && /Safari\//.test(ua)) {
    browser = "Safari";
    browserVersion = match(/Version\/([\d.]+)/);
  }
  if (browserVersion) browserVersion = browserVersion.split(".").slice(0, 2).join(".");

  const tablet = /iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua));
  const mobile = !tablet && /Mobi|iPhone|iPod|Android.*Mobile/i.test(ua);
  const bot = /bot|crawler|spider|curl|wget|python-requests/i.test(ua);
  const deviceType = bot ? "unknown" : tablet ? "tablet" : mobile ? "mobile" : os ? "desktop" : "unknown";

  return { deviceType, browser, browserVersion, os };
}

/**
 * Client IP as seen by the hosting platform. On Vercel the platform overwrites
 * these headers, so a visitor can't forge them. Behind another proxy, set
 * TRUSTED_IP_HEADER to the header your proxy sets.
 */
export function clientIp(h: Headers): string | null {
  const custom = process.env.TRUSTED_IP_HEADER?.trim().toLowerCase();
  const raw =
    (custom && h.get(custom)) ||
    h.get("x-vercel-forwarded-for") ||
    h.get("x-real-ip") ||
    h.get("x-forwarded-for");
  const ip = raw?.split(",")[0]?.trim();
  return ip && /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : null;
}

/**
 * Approximate location from the hosting platform's IP geolocation headers
 * (Vercel adds these for free; no third-party service is called).
 */
export function approximateLocation(h: Headers): { city: string | null; region: string | null; country: string | null } {
  const dec = (v: string | null) => {
    if (!v) return null;
    try {
      const d = decodeURIComponent(v).trim();
      return d && d.length <= 100 ? d : null;
    } catch {
      return null;
    }
  };
  return {
    city: dec(h.get("x-vercel-ip-city")),
    region: dec(h.get("x-vercel-ip-country-region")),
    country: dec(h.get("x-vercel-ip-country")),
  };
}
