import { STATUS_LABEL, type OrderStatus, type WhatsAppStatus } from "@/lib/types";

const STATUS_STYLE: Record<OrderStatus, string> = {
  new: "bg-accent text-white",
  preparing: "bg-accent-soft text-accent",
  ready_for_pickup: "bg-ink text-white",
  completed: "bg-subtle text-muted",
  cancelled: "bg-subtle text-muted line-through",
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>;
}

export const WHATSAPP_LABEL: Record<WhatsAppStatus, string> = {
  pending: "Queued",
  sending: "Sending…",
  not_configured: "Not configured",
  accepted: "Accepted by WhatsApp",
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
  failed: "Failed",
};

export function WhatsAppDot({ status }: { status: WhatsAppStatus }) {
  const color =
    status === "delivered" || status === "read"
      ? "bg-accent"
      : status === "failed"
        ? "bg-danger"
        : status === "not_configured"
          ? "bg-line"
          : "bg-muted/50";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted" title={`WhatsApp: ${WHATSAPP_LABEL[status]}`}>
      <span className={`h-2 w-2 rounded-full ${color}`} aria-hidden />
      <span className="hidden lg:inline">{WHATSAPP_LABEL[status]}</span>
      <span className="sr-only lg:hidden">WhatsApp: {WHATSAPP_LABEL[status]}</span>
    </span>
  );
}
