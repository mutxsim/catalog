import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { formatMoney } from "@/lib/money";
import { STATUS_LABEL, type Order, type OrderItem } from "@/lib/types";

export type InvoiceInput = {
  order: Pick<
    Order,
    | "order_number" | "invoice_number" | "business_name" | "currency" | "subtotal_cents" | "tax_label"
    | "tax_rate" | "tax_cents" | "total_cents" | "seller" | "status" | "created_at"
  >;
  items: OrderItem[];
  logo?: { bytes: Uint8Array; mime: "image/png" | "image/jpeg" } | null;
  timeZone?: string;
};

// US Letter. Fits A4 printing with "fit to page" and reads well on phones.
const PAGE_W = 612;
const PAGE_H = 792;
const M = 48; // margin
const CONTENT_W = PAGE_W - M * 2;

const INK = rgb(0.09, 0.09, 0.1);
const MUTED = rgb(0.42, 0.42, 0.45);
const RULE = rgb(0.86, 0.86, 0.87);

const COLS = {
  item: { x: M, w: 228 },
  sku: { x: M + 236, w: 82 },
  qty: { right: M + 366 },
  unit: { right: M + 442 },
  total: { right: M + CONTENT_W },
};

/** Standard PDF fonts only cover WinAnsi; replace anything else safely. */
function makeSanitizer(font: PDFFont) {
  const ok = new Map<string, boolean>();
  const encodable = (ch: string) => {
    let v = ok.get(ch);
    if (v === undefined) {
      try {
        font.widthOfTextAtSize(ch, 10);
        v = true;
      } catch {
        v = false;
      }
      ok.set(ch, v);
    }
    return v;
  };
  return (input: string) =>
    Array.from(input.replace(/[\r\t]/g, " "))
      .map((ch) => {
        if (ch === "\n" || encodable(ch)) return ch;
        const base = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
        return base && Array.from(base).every(encodable) ? base : "?";
      })
      .join("");
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      // Hard-break words longer than the column.
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > maxWidth) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

export async function renderInvoicePdf(input: InvoiceInput): Promise<Uint8Array> {
  const { order, items } = input;
  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${order.invoice_number}`);
  doc.setSubject(`Invoice ${order.invoice_number}`);
  doc.setProducer("Catalog");
  doc.setCreator("Catalog");
  doc.setCreationDate(new Date(order.created_at));

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const clean = makeSanitizer(font);

  // If the currency symbol cannot be printed with standard fonts, fall back to the ISO code.
  const probe = formatMoney(0, order.currency);
  const moneyDisplay = clean(probe) === probe ? "symbol" : "code";
  const money = (cents: number) => clean(formatMoney(cents, order.currency, moneyDisplay));

  let logo: PDFImage | null = null;
  if (input.logo) {
    try {
      logo = input.logo.mime === "image/png" ? await doc.embedPng(input.logo.bytes) : await doc.embedJpg(input.logo.bytes);
    } catch {
      logo = null; // A broken logo must never block an invoice.
    }
  }

  const seller = order.seller;
  const date = new Date(order.created_at).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: input.timeZone || "UTC",
  });

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  const text = (s: string, x: number, yy: number, size = 10, f = font, color = INK) =>
    page.drawText(clean(s), { x, y: yy, size, font: f, color });
  const textRight = (s: string, right: number, yy: number, size = 10, f = font, color = INK) => {
    const t = clean(s);
    page.drawText(t, { x: right - f.widthOfTextAtSize(t, size), y: yy, size, font: f, color });
  };
  const rule = (yy: number, thickness = 0.75, color = RULE) =>
    page.drawLine({ start: { x: M, y: yy }, end: { x: PAGE_W - M, y: yy }, thickness, color });

  const tableHeader = () => {
    const size = 8;
    text("ITEM", COLS.item.x, y, size, bold, MUTED);
    text("SKU", COLS.sku.x, y, size, bold, MUTED);
    textRight("QTY", COLS.qty.right, y, size, bold, MUTED);
    textRight("UNIT PRICE", COLS.unit.right, y, size, bold, MUTED);
    textRight("TOTAL", COLS.total.right, y, size, bold, MUTED);
    y -= 8;
    rule(y, 0.75, INK);
    y -= 16;
  };

  const newPage = (continued: boolean) => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    y = PAGE_H - M;
    if (continued) {
      text(`Invoice ${order.invoice_number} (continued)`, M, y, 9, font, MUTED);
      y -= 28;
      tableHeader();
    }
  };

  // ---- Header -------------------------------------------------------------
  newPage(false);
  const top = y;
  let leftY = top;
  if (logo) {
    const scale = Math.min(140 / logo.width, 52 / logo.height, 1);
    const w = logo.width * scale;
    const h = logo.height * scale;
    page.drawImage(logo, { x: M, y: top - h, width: w, height: h });
    leftY = top - h - 14;
  }
  if (seller.business_name.trim()) {
    for (const line of wrap(clean(seller.business_name), bold, 12, 280)) {
      text(line, M, leftY - 10, 12, bold);
      leftY -= 16;
    }
  }
  if (seller.address.trim()) {
    for (const line of wrap(clean(seller.address), font, 9, 280)) {
      text(line, M, leftY - 8, 9, font, MUTED);
      leftY -= 12;
    }
  }

  textRight("INVOICE", PAGE_W - M, top - 20, 22, bold);
  let rightY = top - 44;
  const meta: [string, string][] = [
    ["Invoice No.", order.invoice_number],
    ["Order No.", order.order_number],
    ["Date", date],
  ];
  for (const [label, value] of meta) {
    textRight(value, PAGE_W - M, rightY, 9, bold);
    textRight(label, PAGE_W - M - 110, rightY, 9, font, MUTED);
    rightY -= 14;
  }

  y = Math.min(leftY, rightY) - 18;
  rule(y);
  y -= 26;

  // ---- Bill to ------------------------------------------------------------
  text("BILL TO", M, y, 8, bold, MUTED);
  y -= 16;
  const billLabel = "Store / Business Name: ";
  text(billLabel, M, y, 10, font, MUTED);
  const nameX = M + font.widthOfTextAtSize(billLabel, 10);
  const nameLines = wrap(clean(order.business_name), bold, 10, CONTENT_W - (nameX - M));
  nameLines.forEach((line, i) => text(line, nameX, y - i * 14, 10, bold));
  y -= nameLines.length * 14 + 22;

  // ---- Items --------------------------------------------------------------
  tableHeader();
  for (const item of items) {
    const nameLinesItem = wrap(clean(item.name), font, 10, COLS.item.w);
    const skuLines = item.sku ? wrap(clean(item.sku), font, 9, COLS.sku.w) : [];
    const rows = Math.max(nameLinesItem.length, skuLines.length, 1);
    const rowH = rows * 13 + 10;
    if (y - rowH < M + 40) newPage(true);
    nameLinesItem.forEach((l, i) => text(l, COLS.item.x, y - i * 13, 10));
    skuLines.forEach((l, i) => text(l, COLS.sku.x, y - i * 13, 9, font, MUTED));
    textRight(String(item.quantity), COLS.qty.right, y, 10);
    textRight(money(item.unit_price_cents), COLS.unit.right, y, 10);
    textRight(money(item.line_total_cents), COLS.total.right, y, 10);
    y -= rowH - 10;
    y -= 6;
    rule(y + 2);
    y -= 12;
  }

  // ---- Totals + payment details --------------------------------------------
  const pickup = seller.pickup_instructions?.trim() ? wrap(clean(seller.pickup_instructions), font, 9, 270) : [];
  const footer = seller.invoice_footer?.trim() ? wrap(clean(seller.invoice_footer), font, 9, CONTENT_W) : [];
  const blockH = 110 + (pickup.length ? pickup.length * 12 + 20 : 0) + footer.length * 12 + 20;
  if (y - blockH < M) newPage(false);

  y -= 6;
  const totalsTop = y;
  const labelRight = PAGE_W - M - 120;
  const showTax = seller.tax_enabled;
  textRight("Subtotal", labelRight, y, 10, font, MUTED);
  textRight(money(order.subtotal_cents), PAGE_W - M, y, 10);
  y -= 16;
  if (showTax) {
    const rate = Number(order.tax_rate);
    textRight(`${order.tax_label} (${rate.toString()}%)`, labelRight, y, 10, font, MUTED);
    textRight(money(order.tax_cents), PAGE_W - M, y, 10);
    y -= 16;
  }
  page.drawLine({ start: { x: labelRight - 70, y: y + 6 }, end: { x: PAGE_W - M, y: y + 6 }, thickness: 0.75, color: INK });
  y -= 10;
  textRight("Total Due", labelRight, y, 12, bold);
  textRight(money(order.total_cents), PAGE_W - M, y, 12, bold);

  // Left column, aligned with totals
  let ly = totalsTop;
  const pair = (label: string, value: string) => {
    text(label, M, ly, 9, font, MUTED);
    text(value, M + 92, ly, 9, bold);
    ly -= 14;
  };
  pair("Payment method", "Pay In-Store");
  pair("Order status", STATUS_LABEL[order.status] ?? "New");
  if (pickup.length) {
    ly -= 8;
    text("PICKUP INSTRUCTIONS", M, ly, 8, bold, MUTED);
    ly -= 14;
    for (const l of pickup) {
      text(l, M, ly, 9);
      ly -= 12;
    }
  }
  y = Math.min(y, ly) - 30;

  if (footer.length) {
    rule(y + 12);
    for (const l of footer) {
      const w = font.widthOfTextAtSize(l, 9);
      page.drawText(l, { x: (PAGE_W - w) / 2, y: y - 6, size: 9, font, color: MUTED });
      y -= 12;
    }
  }

  // Page numbers when the invoice spans several pages.
  if (pages.length > 1) {
    pages.forEach((p, i) => {
      const label = `Page ${i + 1} of ${pages.length}`;
      p.drawText(label, { x: PAGE_W - M - font.widthOfTextAtSize(label, 8), y: 24, size: 8, font, color: MUTED });
    });
  }

  return doc.save();
}

export function invoiceFileName(invoiceNumber: string) {
  return `Invoice-${invoiceNumber.replace(/[^A-Za-z0-9_-]/g, "")}.pdf`;
}
