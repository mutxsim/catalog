/**
 * End-to-end test of the full ordering workflow against a local Supabase
 * stand-in (no account needed):
 *   catalog → cart → checkout → order saved → PDF invoice → WhatsApp document
 *   → confirmation → admin login → orders → status → product create → settings.
 *
 *   npm run build:e2e && npm run test:e2e
 *
 * Needs a Chromium: set CHROME_PATH, or run `npx playwright install chromium`.
 * Screenshots go to E2E_SCREENSHOTS (default: tests/e2e/screenshots).
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SB = "http://127.0.0.1:54321";
const APP = "http://127.0.0.1:3100";
const shots = process.env.E2E_SCREENSHOTS ?? join(root, "tests", "e2e", "screenshots");
mkdirSync(shots, { recursive: true });

export const E2E_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: SB,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fake-publishable",
  SUPABASE_SECRET_KEY: "fake-secret",
  NEXT_IMAGE_UNOPTIMIZED: "1",
  WHATSAPP_ACCESS_TOKEN: "fake-token",
  WHATSAPP_PHONE_NUMBER_ID: "1234567890",
  WHATSAPP_GRAPH_URL: `${SB}/graph`,
  STORE_TIMEZONE: "America/New_York",
};

const procs = [];
let browser;
const start = (cmd, args, env) => {
  const p = spawn(cmd, args, { cwd: root, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.on("data", (d) => process.env.E2E_VERBOSE && process.stdout.write(d));
  p.stderr.on("data", (d) => process.stderr.write(d));
  procs.push(p);
  return p;
};
const waitFor = async (url, ms = 60000) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`timeout waiting for ${url}`);
};
const sql = async (q, params) => {
  const r = await fetch(`${SB}/__test/sql`, { method: "POST", body: JSON.stringify({ sql: q, params }) });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
};
const step = (s) => console.log(`  ✓ ${s}`);

async function productImage(hue, shape) {
  const bg = `hsl(${hue} 25% 92%)`;
  const fg = `hsl(${hue} 30% 45%)`;
  const body =
    shape === "can"
      ? `<rect x="230" y="150" width="140" height="300" rx="22" fill="${fg}"/><rect x="230" y="190" width="140" height="18" fill="${bg}" opacity=".5"/>`
      : shape === "bottle"
        ? `<rect x="270" y="110" width="60" height="60" rx="8" fill="${fg}"/><rect x="225" y="160" width="150" height="320" rx="40" fill="${fg}"/>`
        : shape === "bag"
          ? `<path d="M200 170 h200 l20 290 h-240 z" fill="${fg}"/><rect x="200" y="150" width="200" height="30" rx="6" fill="${fg}" opacity=".7"/>`
          : `<rect x="180" y="190" width="240" height="240" rx="14" fill="${fg}"/><rect x="180" y="250" width="240" height="14" fill="${bg}" opacity=".5"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="${bg}"/>${body}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function seed() {
  await sql(
    `update public.settings set business_name = 'Your Business', address = '123 Example Street\nCity, ST 00000', whatsapp_number = '12155550100',
       tax_enabled = true, tax_label = 'Sales Tax', tax_rate = 6, pickup_instructions = 'Pick up at the front counter, Mon–Sat 9am–6pm. Bring your order number.',
       invoice_footer = 'Thank you for your order.' where id = 1`,
  );
  const products = [
    ["Spring Water 24 × 16.9 oz", 899, "SW-24", "Beverages", 200, "bottle"],
    ["Sparkling Water Variety 12-pack", 1099, "SP-12", "Beverages", 190, "can"],
    ["Cola 24 × 12 oz Cans", 1349, "CO-24", "Beverages", 0, "can"],
    ["Iced Tea Lemon 12 × 18.5 oz", 1499, "IT-12", "Beverages", 40, "bottle"],
    ["Kettle Chips Sea Salt 24 × 1.5 oz", 1899, "KC-24", "Snacks", 30, "bag"],
    ["Mixed Nuts 12 × 2 oz", 2199, "MN-12", "Snacks", 25, "bag"],
    ["Paper Towels 12 Rolls", 2450, "PT-12", "Household", 220, "box"],
    ["Trash Bags 13 gal, 100 ct", 1675, null, "Household", 260, "box"],
  ];
  let order = 10;
  for (const [name, price, sku, category, hue, shape] of products) {
    const [{ id }] = await sql(
      "insert into public.products (name, price_cents, sku, category, published, sort_order, description) values ($1, $2, $3, $4, true, $5, $6) returning id",
      [name, price, sku, category, order, `Case pack. ${name}. Sold by the case.`],
    );
    const path = `products/${id}/seed.png`;
    await fetch(`${SB}/__test/upload?key=${encodeURIComponent(`product-images/${path}`)}`, { method: "POST", headers: { "content-type": "image/png" }, body: await productImage(hue, shape) });
    await sql("update public.products set image_path = $1 where id = $2", [path, id]);
    order += 10;
  }
  await sql("insert into public.products (name, price_cents, published, sort_order) values ('Hidden Draft Product', 100, false, 999)");
}

async function main() {
  console.log("Starting local Supabase stand-in and app…");
  start("node", ["tests/e2e/fake-supabase.mjs"], {});
  await waitFor(`${SB}/__test/whatsapp`);
  await seed();
  start("node", ["node_modules/next/dist/bin/next", "start", "-p", "3100", "-H", "127.0.0.1"], E2E_ENV);
  await waitFor(`${APP}/`);

  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ["--no-sandbox", "--disable-gpu"],
    headless: true,
  });
  const failures = [];
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  page.on("pageerror", (e) => failures.push(`page error: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !/favicon|status of (404|409)/.test(m.text()) && failures.push(`console: ${m.text()}`));

  // ---- Catalog
  await page.goto(APP);
  await page.getByRole("heading", { name: "Spring Water 24 × 16.9 oz" }).waitFor();
  assert.equal(await page.getByText("Hidden Draft Product").count(), 0, "unpublished products must not show");
  await page.screenshot({ path: join(shots, "01-catalog-mobile.png"), fullPage: true });
  step("catalog lists only published products");

  await page.getByRole("link", { name: "Snacks" }).click();
  await page.waitForURL(/c=Snacks/);
  await page.getByRole("heading", { name: /Kettle Chips/ }).waitFor();
  assert.equal(await page.getByRole("heading", { name: /Spring Water/ }).count(), 0);
  await page.getByRole("link", { name: "All" }).click();
  await page.waitForURL((u) => !u.search);
  await page.getByRole("searchbox", { name: "Search products" }).fill("cola");
  await page.waitForURL(/q=cola/);
  await page.getByRole("heading", { name: /Cola 24/ }).waitFor();
  assert.equal(await page.getByRole("heading", { name: /Spring Water/ }).count(), 0);
  step("category filter and search");

  // ---- Add to cart (grid quantity + detail page)
  await page.goto(APP);
  const card = page.locator("article", { has: page.getByRole("heading", { name: "Spring Water 24 × 16.9 oz" }) });
  await card.getByRole("button", { name: /Increase quantity/ }).click();
  await card.getByRole("button", { name: /Increase quantity/ }).click();
  await card.getByRole("button", { name: "Add to Cart" }).click();
  await page.getByRole("link", { name: /Cart, 3 items/ }).waitFor();
  await page.getByRole("heading", { name: /Kettle Chips/ }).click();
  await page.waitForURL(/\/p\//);
  await page.getByRole("spinbutton").fill("5");
  await page.getByRole("spinbutton").blur();
  await page.getByRole("button", { name: "Add to Cart" }).click();
  await page.getByRole("link", { name: /Cart, 8 items/ }).waitFor();
  await page.screenshot({ path: join(shots, "02-product-mobile.png") });
  step("add to cart from grid and detail view; header count updates");

  // ---- Cart persists across reloads
  await page.reload();
  await page.getByRole("link", { name: /Cart, 8 items/ }).waitFor();
  await page.goto(`${APP}/cart`);
  await page.getByText("Estimated total").waitFor();
  await page.getByText("$129.24").waitFor(); // 3×8.99 + 5×18.99 = 121.92, +6% tax 7.32
  await page.screenshot({ path: join(shots, "03-cart-mobile.png"), fullPage: true });
  step("cart persists in local storage and shows server-priced totals");

  // ---- Price change between page load and checkout is caught by the server
  await page.goto(`${APP}/checkout`);
  await page.getByText("Sales Tax (6%)").waitFor();
  await page.getByLabel("Store / Business Name").fill("Main Street Market");
  await sql("update public.products set price_cents = 999 where sku = 'SW-24'");
  await page.getByRole("button", { name: "Place Order" }).click();
  await page.getByText(/Prices have changed/).waitFor();
  step("server rejects stale prices (never trusts the browser total)");

  // ---- Place order
  await page.getByText("$132.42").waitFor(); // refreshed: 3×9.99 + 5×18.99 = 124.92, +6% tax 7.50
  await page.screenshot({ path: join(shots, "04-checkout-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Place Order" }).click();
  await page.waitForURL(/\/order\/[0-9a-f-]+\?t=/);
  await page.getByRole("heading", { name: "Order Placed Successfully" }).waitFor();
  await page.screenshot({ path: join(shots, "05-confirmation-mobile.png"), fullPage: true });
  const confirmUrl = new URL(page.url());
  const orderId = confirmUrl.pathname.split("/").pop();
  const token = confirmUrl.searchParams.get("t");
  await page.getByRole("link", { name: "Cart, 0 items" }).waitFor();
  step("order placed; confirmation shown; cart cleared");

  const [order] = await sql("select * from public.orders where id = $1", [orderId]);
  const items = await sql("select * from public.order_items where order_id = $1 order by position", [orderId]);
  assert.equal(order.business_name, "Main Street Market");
  assert.equal(items.length, 2);
  assert.equal(Number(order.subtotal_cents), 3 * 999 + 5 * 1899);
  assert.equal(Number(order.tax_cents), Math.round((3 * 999 + 5 * 1899) * 0.06));
  assert.ok(order.invoice_path, "invoice stored at checkout");
  step(`order #${order.order_number} saved with snapshot lines; invoice ${order.invoice_number} stored`);

  // ---- Customer invoice download (and protection)
  const inv = await fetch(`${APP}/api/invoice/${orderId}?t=${token}`);
  assert.equal(inv.status, 200);
  assert.equal(inv.headers.get("content-type"), "application/pdf");
  const invBytes = new Uint8Array(await inv.arrayBuffer());
  const pdf = await PDFDocument.load(invBytes);
  assert.equal(pdf.getTitle(), `Invoice ${order.invoice_number}`);
  assert.equal((await fetch(`${APP}/api/invoice/${orderId}?t=wrong`)).status, 404);
  assert.equal((await fetch(`${APP}/api/invoice/${orderId}`)).status, 404);
  assert.equal((await fetch(`${APP}/order/${orderId}`)).status, 404);
  step("invoice downloads with the private token; guessing the order fails");

  // ---- WhatsApp: same PDF uploaded and sent as a document with the summary
  let log = [];
  for (let i = 0; i < 40 && !log.some((l) => l.kind === "message"); i++) {
    await new Promise((r) => setTimeout(r, 250));
    log = await (await fetch(`${SB}/__test/whatsapp`)).json();
  }
  const media = log.find((l) => l.kind === "media");
  const msg = log.find((l) => l.kind === "message");
  assert.ok(media && msg, "WhatsApp media + message sent");
  assert.equal(media.type, "application/pdf");
  assert.equal(msg.payload.type, "document");
  assert.equal(msg.payload.to, "12155550100");
  assert.equal(msg.payload.document.id, media.id);
  assert.match(msg.payload.document.caption, /NEW WHOLESALE ORDER[\s\S]*Business: Main Street Market[\s\S]*TOTAL DUE: \$/);
  const sentPdf = new Uint8Array(await (await fetch(`${SB}/__test/file?key=whatsapp/${media.id}.pdf`)).arrayBuffer());
  assert.deepEqual(Buffer.from(sentPdf), Buffer.from(invBytes), "WhatsApp attachment is byte-identical to the customer's invoice");
  const [after] = await sql("select whatsapp_status, whatsapp_message_id from public.orders where id = $1", [orderId]);
  assert.equal(after.whatsapp_status, "accepted");
  step("WhatsApp got the identical PDF as a document with the order summary; status 'accepted' (not 'delivered')");

  // ---- Duplicate submission: same key returns the same order
  const dupKey = crypto.randomUUID();
  const productId = items[0].product_id;
  const body = (total) => JSON.stringify({ businessName: "Dup Test", items: [{ productId, quantity: 1 }], expectedTotalCents: total, idempotencyKey: dupKey });
  const q = await (await fetch(`${APP}/api/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: [{ productId, quantity: 1 }] }) })).json();
  const headers = { "content-type": "application/json", origin: APP };
  const [r1, r2] = await Promise.all([
    fetch(`${APP}/api/orders`, { method: "POST", headers, body: body(q.quote.total_cents) }),
    fetch(`${APP}/api/orders`, { method: "POST", headers, body: body(q.quote.total_cents) }),
  ]);
  const [j1, j2] = [await r1.json(), await r2.json()];
  assert.equal(j1.orderId, j2.orderId);
  const [{ n }] = await sql("select count(*)::int as n from public.orders where business_name = 'Dup Test'");
  assert.equal(n, 1);
  assert.equal((await fetch(`${APP}/api/orders`, { method: "POST", headers: { ...headers, origin: "https://evil.example" }, body: body(1) })).status, 403);
  step("concurrent duplicate submissions create one order; cross-site posts refused");

  // ---- Admin
  const admin = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  admin.on("pageerror", (e) => failures.push(`admin page error: ${e.message}`));
  await admin.goto(`${APP}/admin/orders`);
  await admin.waitForURL(/\/admin\/login/);
  const anon = await fetch(`${APP}/admin/orders/${orderId}/invoice`, { redirect: "manual" });
  assert.ok([307, 401].includes(anon.status) && anon.headers.get("content-type") !== "application/pdf", "admin invoice requires login");
  await admin.getByLabel("Email").fill("admin@example.com");
  await admin.getByLabel("Password").fill("wrong");
  await admin.getByRole("button", { name: "Sign in" }).click();
  await admin.getByText("Incorrect email or password.").waitFor();
  assert.equal(await admin.getByLabel("Email").inputValue(), "admin@example.com", "a failed login keeps the typed email");
  await admin.getByLabel("Password").fill("admin-pass-123");
  await admin.getByRole("button", { name: "Sign in" }).click();
  await admin.waitForURL(/\/admin\/orders$/);
  await admin.getByRole("link", { name: `#${order.order_number}` }).waitFor();
  await admin.screenshot({ path: join(shots, "06-admin-orders.png"), fullPage: true });
  step("admin login required; wrong password rejected; orders list visible");

  await admin.getByRole("link", { name: `#${order.order_number}` }).click();
  await admin.getByRole("heading", { name: `Order #${order.order_number}` }).waitFor();
  await admin.getByText("Accepted by WhatsApp").first().waitFor();
  await admin.getByRole("button", { name: "Ready for Pickup" }).click();
  await admin.locator("span", { hasText: "Ready for Pickup" }).first().waitFor();
  const [{ status }] = await sql("select status from public.orders where id = $1", [orderId]);
  assert.equal(status, "ready_for_pickup");
  await admin.screenshot({ path: join(shots, "07-admin-order.png"), fullPage: true });
  const adminPdf = await admin.request.get(`${APP}/admin/orders/${orderId}/invoice`);
  assert.deepEqual(Buffer.from(await adminPdf.body()), Buffer.from(invBytes), "admin reprint is the original invoice");
  const currentPdf = await admin.request.get(`${APP}/admin/orders/${orderId}/invoice?current=1`);
  assert.equal(currentPdf.status(), 200);
  step("status updated; admin downloads the original invoice; current-status reprint available");

  // ---- Retry after a WhatsApp failure
  await sql("update public.orders set whatsapp_status = 'failed', whatsapp_error = 'test failure' where id = $1", [orderId]);
  await admin.reload();
  await admin.getByRole("button", { name: "Retry send" }).click();
  await admin.getByText(/Accepted by WhatsApp\. Delivery is confirmed/).waitFor();
  step("manual WhatsApp retry works");

  // ---- Product management with image upload
  await admin.goto(`${APP}/admin/products`);
  await admin.screenshot({ path: join(shots, "08-admin-products.png"), fullPage: true });
  await admin.getByRole("link", { name: "Add product" }).click();
  await admin.getByLabel("Product name").fill("Energy Drink 24 × 8.4 oz");
  await admin.getByLabel(/Selling price/).fill("32.50");
  await admin.getByLabel(/SKU/).fill("EN-24");
  await admin.getByLabel(/Category/).fill("Beverages");
  await admin.locator('input[name="image"]').setInputFiles({ name: "x.png", mimeType: "image/png", buffer: await productImage(140, "can") });
  await admin.screenshot({ path: join(shots, "09-admin-product-form.png"), fullPage: true });
  await admin.getByRole("button", { name: "Add product" }).click();
  await admin.waitForURL(/\/admin\/products\?saved=/);
  const [created] = await sql("select * from public.products where sku = 'EN-24'");
  assert.equal(created.price_cents, 3250);
  assert.ok(created.image_path);
  // Fake image (SVG pretending to be PNG) is rejected by content sniffing
  await admin.getByRole("link", { name: "Add product" }).click();
  await admin.getByLabel("Product name").fill("Bad Image");
  await admin.getByLabel(/Selling price/).fill("1");
  await admin.locator('input[name="image"]').setInputFiles({ name: "evil.png", mimeType: "image/png", buffer: Buffer.from("<svg onload=alert(1)>") });
  await admin.getByRole("button", { name: "Add product" }).click();
  await admin.getByText(/Unsupported image/).waitFor();
  step("product created with image; disguised non-image upload rejected");

  // ---- Product edits never change existing invoices / orders
  await sql("update public.products set price_cents = 1, name = 'Changed' where sku = 'KC-24'");
  const again = new Uint8Array(await (await fetch(`${APP}/api/invoice/${orderId}?t=${token}`)).arrayBuffer());
  assert.deepEqual(Buffer.from(again), Buffer.from(invBytes));
  step("editing a product leaves the existing invoice unchanged");

  // ---- Settings
  await admin.goto(`${APP}/admin/settings`);
  await admin.getByLabel("Invoice number prefix").fill("WO-");
  await admin.getByRole("button", { name: "Save settings" }).click();
  await admin.getByText("Settings saved.").waitFor();
  await admin.screenshot({ path: join(shots, "10-admin-settings.png"), fullPage: true });
  const [{ invoice_prefix }] = await sql("select invoice_prefix from public.settings");
  assert.equal(invoice_prefix, "WO-");
  step("settings saved");

  // ---- Desktop catalog screenshot
  const desk = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await desk.goto(APP);
  await desk.getByRole("heading", { name: /Energy Drink/ }).waitFor();
  await desk.screenshot({ path: join(shots, "11-catalog-desktop.png"), fullPage: true });
  await desk.goto(`${APP}/p/${created.id}`);
  await desk.screenshot({ path: join(shots, "12-product-desktop.png") });

  await browser.close();
  if (failures.length) throw new Error(`Browser errors:\n${failures.join("\n")}`);
  console.log("\nAll end-to-end checks passed.");
}

main()
  .catch((e) => {
    console.error("\nE2E FAILED:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close().catch(() => {});
    // Stop the servers (and anything they spawned).
    for (const p of procs) {
      try {
        process.kill(-p.pid, "SIGTERM");
      } catch {}
    }
  });
