import type { Metadata } from "next";
import { env } from "@/lib/env";
import { publicStorageUrl } from "@/lib/public-url";
import { getSettings } from "@/lib/settings";
import { requireAdmin } from "@/lib/auth";
import { SettingsForm } from "./settings-form";
import { RetentionForm } from "./retention-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requireAdmin();
  const settings = await getSettings();
  const wa = {
    api: env.whatsapp.configured,
    template: Boolean(env.whatsapp.templateName),
    webhook: Boolean(env.whatsapp.appSecret && env.whatsapp.webhookVerifyToken),
    number: Boolean(settings.whatsapp_number),
  };

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      <SettingsForm settings={settings} logoUrl={publicStorageUrl("branding", settings.logo_path)} />

      <section className="mt-12 border-t border-line pt-8">
        <h2 className="text-base font-semibold">WhatsApp delivery</h2>
        <ul className="mt-3 space-y-2 text-sm">
          <Check ok={wa.number} label="WhatsApp number set above" />
          <Check ok={wa.api} label="Cloud API credentials (WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID)" />
          <Check ok={wa.template} optional label="Approved message template (WHATSAPP_TEMPLATE_NAME) — sends at any time" />
          <Check ok={wa.webhook} optional label="Delivery-status webhook (WHATSAPP_APP_SECRET, WHATSAPP_WEBHOOK_VERIFY_TOKEN)" />
        </ul>
        <p className="mt-3 text-sm text-muted">
          {wa.api && wa.number
            ? wa.template
              ? "New orders are sent to your WhatsApp with the PDF invoice attached."
              : "Without a template, WhatsApp only delivers free-form messages within 24 hours of your last message to the business number. Add a template for reliable delivery."
            : "Automatic delivery is off. Orders are still saved and appear in Orders; customers can send you their order with a prefilled WhatsApp message (no PDF attached). See README → WhatsApp."}
        </p>
      </section>

      <section className="mt-12 border-t border-line pt-8">
        <h2 className="text-base font-semibold">Record retention</h2>
        <p className="mt-2 text-sm text-muted">
          Orders and invoices are kept for {settings.retention_years} year{settings.retention_years === 1 ? "" : "s"} (change above). Nothing is deleted
          automatically. You can remove completed or cancelled orders older than this period below.
        </p>
        <RetentionForm years={settings.retention_years} />
      </section>
    </div>
  );
}

function Check({ ok, label, optional }: { ok: boolean; label: string; optional?: boolean }) {
  return (
    <li className="flex gap-2">
      <span aria-hidden className={ok ? "text-accent" : "text-muted"}>{ok ? "✓" : optional ? "○" : "✕"}</span>
      <span className={ok ? "" : "text-muted"}>{label}{optional && !ok ? " (optional)" : ""}</span>
    </li>
  );
}
