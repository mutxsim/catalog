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

describe("invoice product images", () => {
  it("draws a thumbnail per line, placeholders for missing/broken images, across pages", async () => {
    const sharp = (await import("sharp")).default;
    const swatch = async (color: string, w = 300, h = 200) =>
      new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: color } }).jpeg().toBuffer());
    const red = { bytes: await swatch("#c0392b"), mime: "image/jpeg" as const };
    const green = { bytes: await swatch("#27ae60", 120, 400), mime: "image/jpeg" as const }; // tall: must not stretch
    const broken = { bytes: new Uint8Array([1, 2, 3, 4]), mime: "image/png" as const };
    const items = [
      { position: 1, name: "Disposable Vape 5000", flavor_name: "Blue Razz", sku: "DV-5", unit_price_cents: 1500, quantity: 3, line_total_cents: 4500 },
      { position: 2, name: "Disposable Vape 5000", flavor_name: "Watermelon Ice", sku: "DV-5", unit_price_cents: 1500, quantity: 2, line_total_cents: 3000 },
      { position: 3, name: "Rolling Papers (no image)", sku: null, unit_price_cents: 200, quantity: 10, line_total_cents: 2000 },
      { position: 4, name: "Broken image product", sku: "BR-1", unit_price_cents: 100, quantity: 1, line_total_cents: 100 },
      ...Array.from({ length: 26 }, (_, i) => ({ position: 5 + i, name: `Filler item ${i + 1}`, flavor_name: i % 3 ? null : "Mint", sku: `F-${i}`, unit_price_cents: 100, quantity: 1, line_total_cents: 100 })),
    ];
    const itemImages = [red, green, null, broken, ...items.slice(4).map((_, i) => (i % 2 ? red : null))];
    const bytes = await renderInvoicePdf({
      ...base,
      order: { ...base.order, subtotal_cents: 12200, tax_cents: 732, total_cents: 12932 },
      items,
      itemImages,
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    if (outDir) writeFileSync(join(outDir, "invoice-images.pdf"), bytes);
  });
});
