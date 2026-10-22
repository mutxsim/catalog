import "server-only";
import { requireAdmin } from "@/lib/auth";
import { publicStorageUrl } from "@/lib/public-url";
import { fetchAll } from "@/lib/fetch-all";

export async function getCategories() {
  const { supabase } = await requireAdmin();
  const data = await fetchAll<{ category: string }>((from, to) =>
    supabase.from("products").select("category").not("category", "is", null).order("id").range(from, to),
  );
  return [...new Set(data.map((r) => r.category))].sort((a, b) => a.localeCompare(b));
}

export async function getFlavorRows(productId: string) {
  const { supabase } = await requireAdmin();
  const { data } = await supabase.from("product_flavors").select("id, name, image_path").eq("product_id", productId).order("sort_order").order("name");
  return ((data ?? []) as { id: string; name: string; image_path: string | null }[]).map((f) => ({
    id: f.id,
    name: f.name,
    imageUrl: publicStorageUrl("product-images", f.image_path),
  }));
}
