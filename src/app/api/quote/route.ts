import { createServiceClient } from "@/lib/supabase/server";
import { mapDbError, normaliseQuote } from "@/lib/orders";
import { quoteRequestSchema } from "@/lib/validation";
import type { Quote } from "@/lib/types";
import { customerOrNull, unauthorized } from "@/lib/customer-auth";

export const dynamic = "force-dynamic";

/** Current prices, availability and totals for a cart. Read-only; uses the same pricing as order placement. */
export async function POST(req: Request) {
  if (!(await customerOrNull())) return unauthorized();
  const body = await req.json().catch(() => null);
  const parsed = quoteRequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid cart." }, { status: 400 });

  if (parsed.data.items.length === 0) {
    return Response.json({ quote: null });
  }

  const { data, error } = await createServiceClient().rpc("quote_items", {
    p_items: parsed.data.items.map((i) => ({ product_id: i.productId, flavor_id: i.flavorId ?? null, quantity: i.quantity })),
  });
  if (error) {
    const mapped = mapDbError(error.message);
    return Response.json({ error: mapped?.message ?? "Could not price your cart." }, { status: mapped?.status ?? 500 });
  }
  return Response.json({ quote: normaliseQuote(data as Quote) }, { headers: { "Cache-Control": "no-store" } });
}
