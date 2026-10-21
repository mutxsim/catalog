import { z } from "zod";
import { parsePriceToCents } from "@/lib/money";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v));

export const productSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200, "Name is too long."),
  price: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const cents = parsePriceToCents(v);
      if (cents === null) {
        ctx.addIssue({ code: "custom", message: "Enter a price like 12.50." });
        return z.NEVER;
      }
      return cents;
    }),
  sku: optionalText(64).refine((v) => v === null || /^[\w.\-/ #]+$/.test(v), "SKU can use letters, numbers, spaces and . - / # _"),
  category: optionalText(80),
  group_name: optionalText(200),
  variant_name: optionalText(120),
  description: optionalText(5000),
  published: z.boolean(),
  sort_order: z.coerce.number().int().min(-1_000_000).max(1_000_000),
});

export const orderRequestSchema = z.object({
  businessName: z.string().trim().min(1, "Enter your store or business name.").max(120, "Business name is too long."),
  items: z
    .array(z.object({ productId: z.uuid(), quantity: z.number().int().min(1).max(9999) }))
    .min(1, "Your cart is empty.")
    .max(200),
  expectedTotalCents: z.number().int().min(0),
  idempotencyKey: z.uuid(),
});

export const quoteRequestSchema = z.object({
  items: z
    .array(z.object({ productId: z.uuid(), quantity: z.number().int().min(1).max(9999) }))
    .max(200),
});

export const settingsSchema = z.object({
  business_name: z.string().trim().max(120),
  address: z.string().trim().max(500),
  whatsapp_number: z
    .string()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => v === "" || (v.length >= 8 && v.length <= 15), "Enter the full number with country code, e.g. 1 215 555 0100."),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => /^[A-Z]{3}$/.test(v), "Use a 3-letter currency code like USD."),
  invoice_prefix: z.string().trim().regex(/^[A-Za-z0-9/_-]{0,12}$/, "Prefix: up to 12 letters, numbers, / _ or -."),
  tax_enabled: z.boolean(),
  tax_label: z.string().trim().min(1).max(40),
  tax_rate: z.coerce.number().min(0, "Tax rate can't be negative.").max(100, "Tax rate can't exceed 100%.").transform((v) => Math.round(v * 1000) / 1000),
  invoice_footer: z.string().trim().max(500),
  pickup_instructions: z.string().trim().max(1000),
  retention_years: z.coerce.number().int().min(1).max(50),
});

export function firstError(error: z.ZodError) {
  return error.issues[0]?.message ?? "Please check the form.";
}
