import { adminOrNull } from "@/lib/auth";
import { PRODUCT_CSV_HEADER, toCsv } from "@/lib/csv";
import { centsToInput } from "@/lib/money";
import { fetchAll } from "@/lib/fetch-all";
import { publicStorageUrl } from "@/lib/public-url";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await adminOrNull();
  if (!admin) return new Response("Unauthorized", { status: 401 });

  type Row = { id: string; name: string; price_cents: number; sku: string | null; category: string | null; description: string | null; published: boolean; in_stock: boolean; sort_order: number; image_path: string | null; image_source_url: string | null };
  let data: Row[];
  let flavors: { product_id: string; name: string }[];
  try {
    data = await fetchAll<Row>((from, to) =>
      admin.supabase.from("products").select("id, name, price_cents, sku, category, description, published, in_stock, sort_order, image_path, image_source_url").order("sort_order").order("name").order("id").range(from, to),
    );
    flavors = await fetchAll<{ product_id: string; name: string }>((from, to) =>
      admin.supabase.from("product_flavors").select("product_id, name").order("product_id").order("sort_order").order("name").range(from, to),
    );
  } catch {
    return new Response("Could not export products", { status: 500 });
  }
  const flavorNames = new Map<string, string[]>();
  for (const f of flavors) flavorNames.set(f.product_id, [...(flavorNames.get(f.product_id) ?? []), f.name]);

  const csv = toCsv(
    [...PRODUCT_CSV_HEADER],
    data.map((p) => [p.name, centsToInput(p.price_cents), p.sku, p.category, (flavorNames.get(p.id) ?? []).join("; "), p.description, p.published, p.sort_order, p.image_source_url ?? publicStorageUrl("product-images", p.image_path), p.in_stock]),
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
