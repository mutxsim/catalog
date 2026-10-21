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
};

export type Product = {
  id: string;
  name: string;
  price_cents: number;
  sku: string | null;
  description: string | null;
  category: string | null;
  image_path: string | null;
  published: boolean;
  /** Products sharing a group are shown as one card with flavor options. */
  group_name: string | null;
  /** Flavor / variety label within the group, e.g. "Mango". */
  variant_name: string | null;
  sort_order: number;
};

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
  sku: string | null;
  unit_price_cents: number;
  quantity: number;
  line_total_cents: number;
};

export type QuoteLine = {
  product_id: string;
  name: string;
  sku: string | null;
  image_path: string | null;
  unit_price_cents: number;
  quantity: number;
  line_total_cents: number;
};

export type Quote = {
  lines: QuoteLine[];
  unavailable: string[];
  currency: string;
  subtotal_cents: number;
  tax_enabled: boolean;
  tax_label: string;
  tax_rate: number;
  tax_cents: number;
  total_cents: number;
};
