export type Settings = {
  business_name: string;
  logo_path: string | null;
  address: string;
  whatsapp_number: string;
  currency: string;
  invoice_prefix: string;
  tax_enabled: boolean;
  tax_label: string;
  tax_rate: number;
  invoice_footer: string;
  pickup_instructions: string;
  retention_years: number;
  login_retention_days?: number;
};

export const CATALOGS = ["happy", "vapes"] as const;
export type Catalog = (typeof CATALOGS)[number];
export const CATALOG_LABEL: Record<Catalog, string> = { happy: "Happy", vapes: "Vapes" };
export function isCatalog(v: unknown): v is Catalog {
  return typeof v === "string" && (CATALOGS as readonly string[]).includes(v);
}

export type Product = {
  id: string;
  name: string;
  price_cents: number;
  sku: string | null;
  description: string | null;
  category: string | null;
  /** Which catalog the product is in (0006). Defaults to "happy". */
  catalog: Catalog;
  brand: string | null;
  image_path: string | null;
  published: boolean;
  in_stock: boolean;
  /** Legacy (0002) grouping fields — kept in the database, no longer used by the UI. */
  group_name?: string | null;
  variant_name?: string | null;
  sort_order: number;
};

export type Flavor = {
  id: string;
  product_id: string;
  name: string;
  image_path: string | null;
  in_stock: boolean;
  sort_order: number;
};

export type ProductWithFlavors = Product & { flavors: Flavor[] };

export const ORDER_STATUSES = ["new", "preparing", "ready_for_pickup", "completed", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const STATUS_LABEL: Record<OrderStatus, string> = {
  new: "New",
  preparing: "Preparing",
  ready_for_pickup: "Ready for Pickup",
  completed: "Completed",
  cancelled: "Cancelled",
};

export type WhatsAppStatus = "pending" | "sending" | "not_configured" | "accepted" | "sent" | "delivered" | "read" | "failed";

export type SellerSnapshot = {
  business_name: string;
  address: string;
  logo_path: string | null;
  invoice_footer: string;
  pickup_instructions: string;
  tax_enabled: boolean;
};

export type Order = {
  id: string;
  customer_id?: string | null;
  order_number: string;
  invoice_number: string;
  access_token: string;
  business_name: string;
  currency: string;
  subtotal_cents: number;
  tax_label: string;
  tax_rate: number;
  tax_cents: number;
  total_cents: number;
  seller: SellerSnapshot;
  status: OrderStatus;
  invoice_path: string | null;
  whatsapp_status: WhatsAppStatus;
  whatsapp_message_id: string | null;
  whatsapp_error: string | null;
  whatsapp_attempts: number;
  whatsapp_updated_at: string | null;
  created_at: string;
};

export type OrderItem = {
  position: number;
  name: string;
  flavor_name?: string | null;
  image_path?: string | null;
  sku: string | null;
  unit_price_cents: number;
  quantity: number;
  line_total_cents: number;
};

export type QuoteLine = {
  product_id: string;
  flavor_id: string | null;
  name: string;
  flavor_name: string | null;
  sku: string | null;
  image_path: string | null;
  unit_price_cents: number;
  quantity: number;
  line_total_cents: number;
};

export type Quote = {
  lines: QuoteLine[];
  unavailable: { product_id: string; flavor_id: string | null; reason: "unavailable" | "flavor_required" | "flavor_unavailable" | "out_of_stock" | "flavor_out_of_stock" }[];
  currency: string;
  subtotal_cents: number;
  tax_enabled: boolean;
  tax_label: string;
  tax_rate: number;
  tax_cents: number;
  total_cents: number;
};
