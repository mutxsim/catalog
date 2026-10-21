import "server-only";
import { env } from "@/lib/env";

/** Minimal client for the official WhatsApp Business Cloud API. */
export class WhatsAppError extends Error {}

function base() {
  return `${env.whatsapp.graphUrl}/${env.whatsapp.apiVersion}/${env.whatsapp.phoneNumberId}`;
}

async function call(path: string, init: RequestInit): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${env.whatsapp.accessToken}`, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(20000),
      cache: "no-store",
    });
  } catch (e) {
    throw new WhatsAppError(`Could not reach WhatsApp: ${(e as Error).message}`);
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = body.error as { message?: string; code?: number; error_data?: { details?: string } } | undefined;
    const detail = err?.error_data?.details ? ` — ${err.error_data.details}` : "";
    throw new WhatsAppError(`WhatsApp API ${res.status}${err?.code ? ` (code ${err.code})` : ""}: ${err?.message ?? "request failed"}${detail}`);
  }
  return body;
}

export async function uploadPdf(bytes: Uint8Array, filename: string): Promise<string> {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", "application/pdf");
  form.append("file", new Blob([bytes as BlobPart], { type: "application/pdf" }), filename);
  const body = await call("/media", { method: "POST", body: form });
  if (typeof body.id !== "string") throw new WhatsAppError("WhatsApp did not return a media id");
  return body.id;
}

async function sendMessage(payload: Record<string, unknown>): Promise<string> {
  const body = await call("/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload }),
  });
  const id = (body.messages as { id?: string }[] | undefined)?.[0]?.id;
  if (!id) throw new WhatsAppError("WhatsApp did not return a message id");
  return id;
}

export function sendText(to: string, text: string) {
  return sendMessage({ to, type: "text", text: { body: text, preview_url: false } });
}

export function sendDocument(to: string, mediaId: string, filename: string, caption?: string) {
  return sendMessage({ to, type: "document", document: { id: mediaId, filename, ...(caption ? { caption } : {}) } });
}

export function sendDocumentTemplate(to: string, mediaId: string, filename: string, bodyParams: string[]) {
  return sendMessage({
    to,
    type: "template",
    template: {
      name: env.whatsapp.templateName,
      language: { code: env.whatsapp.templateLanguage },
      components: [
        { type: "header", parameters: [{ type: "document", document: { id: mediaId, filename } }] },
        { type: "body", parameters: bodyParams.map((text) => ({ type: "text", text })) },
      ],
    },
  });
}
