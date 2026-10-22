"use server";

import { randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import { hashAccessCode, hashSessionToken, normaliseAccessCode } from "@/lib/access-code";
import { SESSION_COOKIE, SESSION_DAYS } from "@/lib/customer-auth";
import { approximateLocation, clientIp, parseUserAgent } from "@/lib/request-info";

const MESSAGES: Record<string, string> = {
  invalid_code: "That access code isn't valid. Check it and try again.",
  revoked_code: "This access code is no longer valid. Ask us for your new code.",
  inactive_account: "This account is inactive. Please contact us.",
  rate_limited: "Too many attempts. Please wait 15 minutes and try again.",
};

export async function customerLogin(_prev: { error: string } | null, formData: FormData): Promise<{ error: string } | null> {
  const code = normaliseAccessCode(String(formData.get("code") ?? ""));
  if (!code) return { error: "Enter your access code." };
  if (code.length > 64) return { error: MESSAGES.invalid_code };

  const h = await headers();
  const ua = h.get("user-agent");
  const device = parseUserAgent(ua);
  const geo = approximateLocation(h);
  const token = randomBytes(32).toString("base64url");

  const { data, error } = await createServiceClient().rpc("customer_login", {
    p_code_hash: hashAccessCode(code),
    p_session_hash: hashSessionToken(token),
    p_ip: clientIp(h),
    p_user_agent: ua?.slice(0, 400) ?? null,
    p_device_type: device.deviceType,
    p_browser: device.browser,
    p_browser_version: device.browserVersion,
    p_os: device.os,
    p_city: geo.city,
    p_region: geo.region,
    p_country: geo.country,
    p_rate_limit: Number(process.env.LOGIN_RATE_LIMIT ?? 10),
    p_rate_window_minutes: 15,
    p_session_days: SESSION_DAYS,
  });
  if (error) {
    console.error("[login] customer_login failed:", error.message);
    return { error: "We couldn't sign you in right now. Please try again." };
  }
  const row = (Array.isArray(data) ? data[0] : data) as { status: string } | undefined;
  if (row?.status !== "ok") return { error: MESSAGES[row?.status ?? "invalid_code"] ?? MESSAGES.invalid_code };

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  redirect("/");
}

export async function customerLogout() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await createServiceClient().rpc("customer_logout", { p_session_hash: hashSessionToken(token) });
  store.delete(SESSION_COOKIE);
  redirect("/login?reason=logout");
}
