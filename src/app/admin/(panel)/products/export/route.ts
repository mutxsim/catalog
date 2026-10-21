import { adminOrNull } from "@/lib/auth";
import { PRODUCT_CSV_HEADER, toCsv } from "@/lib/csv";
import { centsToInput } from "@/lib/money";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await adminOrNull();
  if (!admin) return new Response("Unauthorized", { status: 401 });

  const { data, error } = await admin.supabase
    .from("products")
    .select("name, price_cents, sku, category, description, published, sort_order")
    .order("sort_order")
    .order("name");
  if (error) return new Response("Could not export products", { status: 500 });

  const csv = toCsv(
    [...PRODUCT_CSV_HEADER],
    (data ?? []).map((p) => [p.name, centsToInput(p.price_cents), p.sku, p.category, p.description, p.published, p.sort_order]),
  );
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="products-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
