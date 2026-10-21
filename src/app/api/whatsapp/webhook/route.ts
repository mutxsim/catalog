import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/server";
import { nextWhatsAppStatus } from "@/lib/whatsapp/status";

export const dynamic = "force-dynamic";

/** Webhook verification handshake (Meta App Dashboard → WhatsApp → Configuration). */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const expected = env.whatsapp.webhookVerifyToken;
  if (expected && p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === expected) {
    return new Response(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

type StatusUpdate = { id?: string; status?: string; errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[] };

/** Delivery status updates: sent → delivered → read, or failed. */
export async function POST(req: Request) {
  const secret = env.whatsapp.appSecret;
  if (!secret) return new Response("Webhook not configured", { status: 403 });

  const raw = await req.text();
  const signature = req.headers.get("x-hub-signature-256") ?? "";
  const expected = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return new Response("Invalid signature", { status: 401 });

  let payload: { entry?: { changes?: { value?: { statuses?: StatusUpdate[] } }[] }[] };
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const db = createServiceClient();
  const statuses = (payload.entry ?? []).flatMap((e) => (e.changes ?? []).flatMap((c) => c.value?.statuses ?? []));
  for (const s of statuses) {
    if (!s.id || !s.status) continue;
    const { data: order } = await db.from("orders").select("id, whatsapp_status").eq("whatsapp_message_id", s.id).maybeSingle();
    if (!order) continue;
    const next = nextWhatsAppStatus(order.whatsapp_status, s.status);
    if (!next) continue;
    const err = s.errors?.[0];
    await db
      .from("orders")
      .update({
        whatsapp_status: next,
        whatsapp_updated_at: new Date().toISOString(),
        ...(next === "failed"
          ? { whatsapp_error: `WhatsApp reported failure${err?.code ? ` (code ${err.code})` : ""}: ${err?.error_data?.details ?? err?.message ?? err?.title ?? "unknown"}`.slice(0, 500) }
          : { whatsapp_error: null }),
      })
      .eq("id", order.id);
  }
  return new Response("OK", { status: 200 });
}
