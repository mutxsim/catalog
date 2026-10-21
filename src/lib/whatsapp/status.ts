import type { WhatsAppStatus } from "@/lib/types";

const RANK: Partial<Record<WhatsAppStatus, number>> = { accepted: 1, sent: 2, delivered: 3, read: 4 };

/**
 * Status updates can arrive out of order; only ever move forward.
 * Returns the new status, or null if the update should be ignored.
 */
export function nextWhatsAppStatus(current: string, incoming: string): WhatsAppStatus | null {
  if (incoming === "failed") return current === "delivered" || current === "read" ? null : "failed";
  const inRank = RANK[incoming as WhatsAppStatus];
  if (!inRank) return null;
  const curRank = RANK[current as WhatsAppStatus] ?? 0;
  if (current === "failed" || current === "sending" || current === "pending") return null;
  return inRank > curRank ? (incoming as WhatsAppStatus) : null;
}
