import { randomBytes } from "node:crypto";
import { after } from "next/server";
import { env } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/server";
import { clientHash, isSameOrigin, mapDbError } from "@/lib/orders";
import { ensureInvoice } from "@/lib/invoice/service";
import { notifyOrder } from "@/lib/whatsapp/notify";
import { firstError, orderRequestSchema } from "@/lib/validation";
import { customerOrNull, unauthorized } from "@/lib/customer-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return Response.json({ error: "Forbidden." }, { status: 403 });
  const customer = await customerOrNull();
  if (!customer) return unauthorized();
  if (Number(req.headers.get("content-length") ?? 0) > 64 * 1024) {
    return Response.json({ error: "Order is too large." }, { status: 413 });
  }

  const body = await req.json().catch(() => null);
  const parsed = orderRequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: firstError(parsed.error) }, { status: 422 });
  const { businessName, items, expectedTotalCents, idempotencyKey } = parsed.data;

  const db = createServiceClient();
  const { data, error } = await db.rpc("place_order", {
    p_business_name: businessName,
    p_items: items.map((i) => ({ product_id: i.productId, flavor_id: i.flavorId ?? null, quantity: i.quantity })),
    p_idempotency_key: idempotencyKey,
    p_access_token: randomBytes(32).toString("base64url"),
    p_expected_total_cents: expectedTotalCents,
    p_client_hash: clientHash(req.headers),
    p_rate_limit: env.orderRateLimit,
    p_rate_window_minutes: env.orderRateWindowMinutes,
    p_customer_id: customer.customerId,
  });

  if (error) {
    const mapped = mapDbError(error.message);
    if (!mapped) console.error("[orders] place_order failed:", error.message);
    return Response.json(
      { error: mapped?.message ?? "We couldn't place your order. Please try again.", code: mapped?.code },
      { status: mapped?.status ?? 500 },
    );
  }

  const row = (Array.isArray(data) ? data[0] : data) as { order_id: string; order_number: string; access_token: string; created: boolean };

  // The order is saved. Generate the invoice now so it can be downloaded right away;
  // if that fails it is generated on first download instead — the order is never lost.
  try {
    await ensureInvoice(row.order_id);
  } catch (e) {
    console.error(`[orders] invoice generation deferred for ${row.order_id}:`, (e as Error).message);
  }

  // Notify the owner after the response is sent.
  if (row.created) {
    after(async () => {
      try {
        await notifyOrder(row.order_id);
      } catch (e) {
        console.error(`[orders] WhatsApp notification error for ${row.order_id}:`, (e as Error).message);
      }
    });
  }

  return Response.json({ orderId: row.order_id, orderNumber: row.order_number, token: row.access_token }, { status: row.created ? 201 : 200 });
}
