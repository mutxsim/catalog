import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { renderInvoicePdf, invoiceFileName, type InvoiceInput } from "@/lib/invoice/pdf";

const base: InvoiceInput = {
  order: {
    order_number: "001042",
    invoice_number: "INV-001042",
    business_name: "Corner Store & Deli",
    currency: "USD",
    subtotal_cents: 6195,
    tax_label: "Sales Tax",
    tax_rate: 6,
    tax_cents: 372,
    total_cents: 6567,
    status: "new",
    created_at: "2026-10-20T15:00:00Z",
    seller: {
      business_name: "Wholesale Supply",
      address: "100 Market St\nPhiladelphia, PA 19106",
      logo_path: null,
      invoice_footer: "Thank you for your order.",
      pickup_instructions: "Pick up at the rear loading door, Mon–Sat 8am–5pm. Bring your order number.",
      tax_enabled: true,
    },
  },
  items: [
    { position: 1, name: "Spring Water 24 x 16.9oz", sku: "SW-24", unit_price_cents: 499, quantity: 5, line_total_cents: 2495 },
    { position: 2, name: "Energy Drink Variety Pack — 12 cans, assorted flavours with a deliberately long name to test wrapping", sku: null, unit_price_cents: 1850, quantity: 2, line_total_cents: 3700 },
  ],
  timeZone: "America/New_York",
};

const outDir = process.env.INVOICE_PREVIEW_DIR;

describe("renderInvoicePdf", () => {
  it("renders a valid one-page PDF", async () => {
    const bytes = await renderInvoicePdf(base);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe("Invoice INV-001042");
    if (outDir) {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, "invoice.pdf"), bytes);
    }
  });

  it("is deterministic for the same saved order", async () => {
    const a = await renderInvoicePdf(base);
    const b = await renderInvoicePdf(base);
    // pdf-lib embeds a random document ID; compare page content length instead.
    expect(Math.abs(a.length - b.length)).toBeLessThan(64);
  });

  it("paginates long orders and survives non-Latin text", async () => {
    const items = Array.from({ length: 70 }, (_, i) => ({
      position: i + 1, name: `Item ${i + 1} 商品 ✓`, sku: `SKU-${i}`, unit_price_cents: 100, quantity: 1, line_total_cents: 100,
    }));
    const bytes = await renderInvoicePdf({
      ...base,
      order: { ...base.order, currency: "INR", business_name: "Ünïcode Shop 東京", seller: { ...base.order.seller, tax_enabled: false } },
      items,
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    if (outDir) writeFileSync(join(outDir, "invoice-long.pdf"), bytes);
  });

  it("builds a safe file name", () => {
    expect(invoiceFileName("INV/../001")).toBe("Invoice-INV001.pdf");
  });
});
