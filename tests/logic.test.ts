import { describe, expect, it } from "vitest";
import { formatMoney, parsePriceToCents } from "@/lib/money";
import { parseCsv, toCsv, parseBool } from "@/lib/csv";
import { sniffImage } from "@/lib/uploads";
import { buildOrderSummary, buildTemplateParams, waMeLink, normaliseWhatsAppNumber } from "@/lib/whatsapp/message";
import { nextWhatsAppStatus } from "@/lib/whatsapp/status";
import { orderRequestSchema, settingsSchema } from "@/lib/validation";

const order = {
  order_number: "001001",
  business_name: "Main St Market",
  currency: "USD",
  subtotal_cents: 4500,
  tax_label: "Sales Tax",
  tax_cents: 270,
  total_cents: 4770,
  status: "new" as const,
  seller: { business_name: "", address: "", logo_path: null, invoice_footer: "", pickup_instructions: "", tax_enabled: true },
};
const items = [
  { name: "Water 24pk", quantity: 2, line_total_cents: 2000 },
  { name: "Chips   Variety\nBox", quantity: 1, line_total_cents: 2500 },
];

describe("money", () => {
  it("parses prices into cents without float error", () => {
    expect(parsePriceToCents("12.5")).toBe(1250);
    expect(parsePriceToCents("$1,234.56")).toBe(123456);
    expect(parsePriceToCents("0.1")).toBe(10);
    expect(parsePriceToCents("19.99")).toBe(1999);
    expect(parsePriceToCents("1.234")).toBeNull();
    expect(parsePriceToCents("-1")).toBeNull();
    expect(parsePriceToCents("abc")).toBeNull();
  });
  it("formats consistently with two decimals", () => {
    expect(formatMoney(123456, "USD")).toBe("$1,234.56");
    expect(formatMoney(5, "EUR")).toBe("€0.05");
    expect(formatMoney(100, "XXX-bad")).toBe("$1.00");
  });
});

describe("whatsapp message", () => {
  it("matches the required order summary format", () => {
    const text = buildOrderSummary(order, items, { attachmentNote: "Invoice: Attached PDF" });
    expect(text).toContain("NEW WHOLESALE ORDER");
    expect(text).toContain("Order #: 001001");
    expect(text).toContain("Business: Main St Market");
    expect(text).toContain("• Water 24pk × 2 — $20.00");
    expect(text).toContain("Subtotal: $45.00");
    expect(text).toContain("Sales Tax: $2.70");
    expect(text).toContain("TOTAL DUE: $47.70");
    expect(text).toContain("Payment: In-store");
    expect(text).toContain("Status: New");
    expect(text.trim().endsWith("Invoice: Attached PDF")).toBe(true);
  });
  it("omits tax when disabled", () => {
    const text = buildOrderSummary({ ...order, seller: { ...order.seller, tax_enabled: false } }, items);
    expect(text).not.toContain("Sales Tax");
  });
  it("builds single-line template params", () => {
    const params = buildTemplateParams(order, items);
    expect(params).toHaveLength(4);
    params.forEach((p) => expect(p).not.toMatch(/\n|\s{2,}/));
    expect(params[3]).toContain("Chips Variety Box x1");
  });
  it("truncates very long item lists for templates", () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ name: `Product number ${i}`, quantity: 1, line_total_cents: 100 }));
    const [, , , list] = buildTemplateParams(order, many);
    expect(list.length).toBeLessThan(700);
    expect(list).toMatch(/\+\d+ more \(see PDF\)$/);
  });
  it("builds wa.me links and normalises numbers", () => {
    expect(normaliseWhatsAppNumber("+1 (215) 555-0100")).toBe("12155550100");
    expect(waMeLink("+1 215 555 0100", "Hi there")).toBe("https://wa.me/12155550100?text=Hi%20there");
    expect(waMeLink("", "x")).toBeNull();
  });
});

describe("whatsapp status transitions", () => {
  it("only moves forward", () => {
    expect(nextWhatsAppStatus("accepted", "sent")).toBe("sent");
    expect(nextWhatsAppStatus("sent", "delivered")).toBe("delivered");
    expect(nextWhatsAppStatus("delivered", "sent")).toBeNull();
    expect(nextWhatsAppStatus("read", "delivered")).toBeNull();
    expect(nextWhatsAppStatus("accepted", "failed")).toBe("failed");
    expect(nextWhatsAppStatus("read", "failed")).toBeNull();
    expect(nextWhatsAppStatus("accepted", "weird")).toBeNull();
  });
});

describe("csv", () => {
  it("round-trips quoted fields", () => {
    const csv = toCsv(["name", "description"], [["A, B", 'Say "hi"\nnext line'], ["Plain", null]]);
    expect(parseCsv(csv)).toEqual([["name", "description"], ["A, B", 'Say "hi"\nnext line'], ["Plain", ""]]);
  });
  it("neutralises formula injection on export", () => {
    expect(toCsv(["x"], [["=HYPERLINK(1)"], ["-5"]])).toBe("x\r\n'=HYPERLINK(1)\r\n-5\r\n");
  });
  it("parses booleans", () => {
    expect(parseBool("yes", false)).toBe(true);
    expect(parseBool("0", true)).toBe(false);
    expect(parseBool("", true)).toBe(true);
  });
});

describe("uploads", () => {
  it("identifies images by content, not name", () => {
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe("image/jpeg");
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.mime).toBe("image/png");
    expect(sniffImage(new TextEncoder().encode("RIFF1234WEBPVP8 "))?.mime).toBe("image/webp");
    expect(sniffImage(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
  });
});

describe("validation", () => {
  it("accepts a valid order request and rejects bad ones", () => {
    const ok = {
      businessName: "Shop",
      items: [{ productId: "3f2b8c1e-1d2a-4b7c-9e3f-0a1b2c3d4e5f", quantity: 2 }],
      expectedTotalCents: 100,
      idempotencyKey: "8d7e6f5a-4b3c-4d2e-9f1a-0b1c2d3e4f5a",
    };
    expect(orderRequestSchema.safeParse(ok).success).toBe(true);
    expect(orderRequestSchema.safeParse({ ...ok, businessName: "  " }).success).toBe(false);
    expect(orderRequestSchema.safeParse({ ...ok, items: [] }).success).toBe(false);
    expect(orderRequestSchema.safeParse({ ...ok, items: [{ ...ok.items[0], quantity: 0 }] }).success).toBe(false);
    // Prices are never accepted from the browser — extra fields are stripped.
    const parsed = orderRequestSchema.parse({ ...ok, items: [{ ...ok.items[0], price: 1 }] });
    expect(parsed.items[0]).not.toHaveProperty("price");
  });
  it("normalises settings", () => {
    const r = settingsSchema.parse({
      business_name: "X", address: "", whatsapp_number: "+1 (215) 555-0100", currency: "usd", invoice_prefix: "INV-",
      tax_enabled: true, tax_label: "Tax", tax_rate: "6.6251", invoice_footer: "", pickup_instructions: "", retention_years: "7", login_retention_days: "365",
    });
    expect(r.whatsapp_number).toBe("12155550100");
    expect(r.currency).toBe("USD");
    expect(r.tax_rate).toBe(6.625);
  });
});
