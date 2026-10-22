"use client";

import Image from "next/image";
import { useState } from "react";
import { useActionForm } from "@/components/use-action-form";
import { btn, hint, input, label, textarea } from "@/components/ui";
import type { Settings } from "@/lib/types";
import { saveSettings } from "./actions";

export function SettingsForm({ settings, logoUrl }: { settings: Settings; logoUrl: string | null }) {
  const { state, pending, onSubmit } = useActionForm(saveSettings, null);
  const [taxOn, setTaxOn] = useState(settings.tax_enabled);

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-10">
      <Section title="Business">
        <Field id="business_name" label="Business name" hint="Shown in the catalog header and on invoices.">
          <input id="business_name" name="business_name" maxLength={120} defaultValue={settings.business_name} className={input} />
        </Field>
        <Field id="address" label="Store address" hint="Printed on invoices.">
          <textarea id="address" name="address" rows={3} maxLength={500} defaultValue={settings.address} className={textarea} />
        </Field>
        <div>
          <span className={label}>Logo</span>
          <div className="flex items-center gap-4">
            <div className="relative flex h-16 w-32 items-center justify-center overflow-hidden rounded-lg border border-line bg-card">
              {logoUrl ? <Image src={logoUrl} alt="Current logo" fill sizes="128px" className="object-contain p-2" /> : <span className="text-xs text-muted">No logo</span>}
            </div>
            <div className="space-y-2">
              <input name="logo" type="file" accept="image/png,image/jpeg" className="text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-card file:px-3 file:py-1.5 file:text-sm" />
              {logoUrl && (
                <label className="flex items-center gap-2 text-sm text-muted">
                  <input type="checkbox" name="remove_logo" /> Remove logo
                </label>
              )}
            </div>
          </div>
          <p className={hint}>PNG or JPG, up to 2 MB. Appears in the header and on new invoices.</p>
        </div>
        <Field id="whatsapp_number" label="WhatsApp number" hint="Where new orders are sent. Include the country code, e.g. 1 215 555 0100.">
          <input id="whatsapp_number" name="whatsapp_number" inputMode="tel" defaultValue={settings.whatsapp_number} className={`${input} tabular`} />
        </Field>
      </Section>

      <Section title="Invoices">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="currency" label="Currency" hint="3-letter code, e.g. USD.">
            <input id="currency" name="currency" maxLength={3} defaultValue={settings.currency} className={`${input} uppercase`} />
          </Field>
          <Field id="invoice_prefix" label="Invoice number prefix" hint="Applies to new invoices, e.g. INV-001001.">
            <input id="invoice_prefix" name="invoice_prefix" maxLength={12} defaultValue={settings.invoice_prefix} className={input} />
          </Field>
        </div>
        <label className="flex cursor-pointer items-center gap-3">
          <input type="checkbox" name="tax_enabled" checked={taxOn} onChange={(e) => setTaxOn(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
          <span className="text-sm font-medium">Charge tax</span>
        </label>
        {taxOn && (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="tax_label" label="Tax label">
              <input id="tax_label" name="tax_label" maxLength={40} defaultValue={settings.tax_label} className={input} />
            </Field>
            <Field id="tax_rate" label="Tax rate (%)">
              <input id="tax_rate" name="tax_rate" inputMode="decimal" defaultValue={settings.tax_rate} className={`${input} tabular`} />
            </Field>
          </div>
        )}
        {!taxOn && (
          <>
            <input type="hidden" name="tax_label" value={settings.tax_label} />
            <input type="hidden" name="tax_rate" value={settings.tax_rate} />
          </>
        )}
        <Field id="pickup_instructions" label="Pickup instructions" hint="Shown after checkout and on invoices.">
          <textarea id="pickup_instructions" name="pickup_instructions" rows={3} maxLength={1000} defaultValue={settings.pickup_instructions} className={textarea} />
        </Field>
        <Field id="invoice_footer" label="Invoice footer">
          <input id="invoice_footer" name="invoice_footer" maxLength={500} defaultValue={settings.invoice_footer} className={input} />
        </Field>
        <Field id="retention_years" label="Keep order records for (years)">
          <input id="retention_years" name="retention_years" type="number" min={1} max={50} defaultValue={settings.retention_years} className={`${input} tabular max-w-32`} />
        </Field>
        <Field id="login_retention_days" label="Keep login records for (days)" hint="Customer login activity older than this can be removed from Login Activity → Retention.">
          <input id="login_retention_days" name="login_retention_days" type="number" min={30} max={3650} defaultValue={settings.login_retention_days ?? 365} className={`${input} tabular max-w-32`} />
        </Field>
      </Section>

      <div className="flex items-center gap-3">
        <button disabled={pending} className={btn.primary}>{pending ? "Saving…" : "Save settings"}</button>
        {state?.ok && <p className="text-sm text-accent">{state.ok}</p>}
        {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-5">
      <legend className="mb-4 text-xs font-medium uppercase tracking-wide text-muted">{title}</legend>
      {children}
    </fieldset>
  );
}

function Field({ id, label: text, hint: help, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className={label}>{text}</label>
      {children}
      {help && <p className={hint}>{help}</p>}
    </div>
  );
}
