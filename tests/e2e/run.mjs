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
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { createHash } from "node:crypto";

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
  INSECURE_COOKIES: "1", // plain-HTTP test server
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
const codeHash = (c) => createHash("sha256").update(`access-code:${c.toUpperCase().replace(/[^A-Z0-9]/g, "")}`).digest("hex");
const MAIN_CODE = "K7QM-2XTR-9HBD-PW4C";
// What the hosting platform would add; lets the test check IP and location capture.
const SHOPPER_HEADERS = { "x-forwarded-for": "203.0.113.10", "x-vercel-ip-city": "Philadelphia", "x-vercel-ip-country-region": "PA", "x-vercel-ip-country": "US" };
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
async function loginAs(page, code) {
  await page.goto(`${APP}/login`);
  await page.getByLabel("Access Code").fill(code);
  await page.getByRole("button", { name: "Login" }).click();
  await page.waitForURL((u) => u.pathname === "/");
}

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

  // One product with seven flavors (some with their own photo).
  const [{ id: shotId }] = await sql(
    "insert into public.products (name, price_cents, sku, category, published, sort_order, description) values ('Energy Shot 2 oz, 12 ct', 2400, 'ES-12', 'Beverages', true, 15, 'Twelve 2 oz shots per case.') returning id",
  );
  const shotPath = `products/${shotId}/seed.png`;
  await fetch(`${SB}/__test/upload?key=${encodeURIComponent(`product-images/${shotPath}`)}`, { method: "POST", headers: { "content-type": "image/png" }, body: await productImage(25, "bottle") });
  await sql("update public.products set image_path = $1 where id = $2", [shotPath, shotId]);
  const flavors = [["Berry", null], ["Lemon Lime", null], ["Grape", 280], ["Orange", null], ["Mango", null], ["Peach", null], ["Watermelon", 350]];
  for (const [k, [flavor, hue]] of flavors.entries()) {
    let image = null;
    if (hue !== null) {
      image = `products/${shotId}/flavors/${flavor}.png`;
      await fetch(`${SB}/__test/upload?key=${encodeURIComponent(`product-images/${image}`)}`, { method: "POST", headers: { "content-type": "image/png" }, body: await productImage(hue, "can") });
    }
    await sql("insert into public.product_flavors (product_id, name, image_path, sort_order) values ($1, $2, $3, $4)", [shotId, flavor, image, (k + 1) * 10]);
  }

  // A large catalog like a real inventory import (1,350 more products, a few with flavors).
  await sql(
    "insert into public.products (name, price_cents, sku, category, published, sort_order) select 'Bulk Item ' || lpad(g::text, 4, '0'), 1000 + g, 'BULK-' || g, 'THCA', true, 100000 + g from generate_series(1, 1350) g",
  );
  await sql(
    "insert into public.product_flavors (product_id, name, sort_order) select p.id, f.name, f.ord from public.products p cross join (values ('Mint', 1), ('Mango', 2)) as f(name, ord) where p.sku in ('BULK-1', 'BULK-700', 'BULK-1350')",
  );
  // Brands on a few Happy products, and one product in the Vapes catalog.
  await sql("update public.products set brand = 'Crisp Co' where sku in ('KC-24', 'MN-12')");
  await sql("update public.products set brand = 'Clear Springs' where sku in ('SW-24', 'SP-12')");
  await sql(
    "insert into public.products (name, price_cents, sku, category, brand, catalog, published, sort_order) values ('Cloud Disposable 2g', 1999, 'CL-2G', 'Disposables', 'Cloudline', 'vapes', true, 10)",
  );

  // The main shopper's account (created by the admin UI later in the test for a second account).
  await sql("select public.create_customer('Main Street Market', $1, 'PW4C')", [codeHash(MAIN_CODE)]);
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
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, extraHTTPHeaders: SHOPPER_HEADERS, userAgent: IPHONE_UA });
  page.on("pageerror", (e) => failures.push(`page error: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !/favicon|status of (404|409)/.test(m.text()) && failures.push(`console: ${m.text()}`));

  // ---- Access-code login protects every customer page and API
  const anonPage = await fetch(`${APP}/`, { redirect: "manual" });
  assert.equal(anonPage.status, 307);
  assert.match(anonPage.headers.get("location") ?? "", /\/login/);
  for (const path of ["/cart", "/checkout", "/p/00000000-0000-4000-8000-000000000000"]) {
    assert.match((await fetch(`${APP}${path}`, { redirect: "manual" })).headers.get("location") ?? "", /\/login/, `${path} needs login`);
  }
  // A forged cookie gets nothing either.
  const forged = await fetch(`${APP}/`, { redirect: "manual", headers: { cookie: "catalog_session=" + "x".repeat(43) } });
  assert.match(forged.headers.get("location") ?? "", /\/login/);
  assert.equal((await fetch(`${APP}/api/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"items":[]}' })).status, 401);
  assert.equal((await fetch(`${APP}/api/orders`, { method: "POST", headers: { "content-type": "application/json", origin: APP }, body: "{}" })).status, 401);

  await page.goto(APP);
  await page.waitForURL(/\/login/);
  assert.equal(await page.getByText(/^catalog$/i).count(), 1, "CATALOG appears once on the login screen");
  await page.getByLabel("Access Code").fill("ABCD-EFGH-JKMN-PQRS");
  await page.getByRole("button", { name: "Login" }).click();
  await page.getByText(/isn't valid/).waitFor();
  await page.screenshot({ path: join(shots, "00-login-mobile.png") });
  await page.getByLabel("Access Code").fill(MAIN_CODE.toLowerCase().replace(/-/g, " ")); // forgiving input
  await page.getByRole("button", { name: "Login" }).click();
  await page.waitForURL((u) => u.pathname === "/");
  step("catalog, product, cart, checkout and APIs require a valid access code; code-only login works");

  // ---- Choose a catalog
  await page.goto(APP);
  assert.equal(await page.getByText(/^catalog$/i).count(), 1, "the word CATALOG appears exactly once");
  await page.getByRole("link", { name: /Vapes/ }).first().waitFor();
  await page.screenshot({ path: join(shots, "00b-choose-catalog-mobile.png"), fullPage: true });
  await page.locator("main").getByRole("link", { name: /Shop Vapes/ }).click();
  await page.waitForURL(/\/shop\/vapes$/);
  await page.getByRole("heading", { name: "Cloud Disposable 2g" }).waitFor();
  assert.equal(await page.getByRole("heading", { name: /Spring Water/ }).count(), 0, "Happy products stay out of Vapes");
  await page.getByText(/^1 product$/).waitFor();
  await page.goto(`${APP}/?q=cola`);
  await page.waitForURL(/\/shop\/happy\?q=cola/);
  await page.goto(APP);
  await page.locator("main").getByRole("link", { name: /Shop Happy/ }).click();
  await page.waitForURL(/\/shop\/happy$/);
  step("after login customers choose Vapes or Happy; each shows only its own products; old links go to Happy");

  // ---- Catalog
  await page.getByRole("heading", { name: "Spring Water 24 × 16.9 oz" }).waitFor();
  assert.equal(await page.getByText("Hidden Draft Product").count(), 0, "unpublished products must not show");
  assert.equal(await page.getByRole("heading", { name: "Cloud Disposable 2g" }).count(), 0, "Vapes products stay out of Happy");
  await page.getByText(/1359 products · page 1 of 29/).waitFor();
  assert.equal(await page.locator("article").count(), 48, "one page of products at a time");
  await page.screenshot({ path: join(shots, "01-catalog-mobile.png"), fullPage: true });
  await page.getByRole("link", { name: "Next →" }).click();
  await page.waitForURL(/page=2/);
  await page.getByText(/page 2 of 29/).waitFor();
  await page.goto(`${APP}/shop/happy?page=29`);
  await page.getByRole("heading", { name: "Bulk Item 1350" }).waitFor();
  await page.locator("article", { has: page.getByRole("heading", { name: "Bulk Item 1350" }) }).getByLabel("Flavor").waitFor();
  await page.goto(`${APP}/shop/happy?q=bulk%20item%2007`);
  await page.getByText(/^\d+ results for/).waitFor();
  step("catalog lists only published products; 1,359 products load in pages of 48 (flavors included)");

  await page.goto(`${APP}/shop/happy`);
  const itemRow = page.getByRole("group", { name: "Items" });
  const brandRow = page.getByRole("group", { name: "Brands" });
  assert.equal(await brandRow.getByRole("button", { name: "Cloudline" }).count(), 0, "Vapes brands don't show in Happy");
  await page.screenshot({ path: join(shots, "01a-filters-mobile.png") });
  await itemRow.getByRole("button", { name: "Snacks" }).click();
  await page.waitForURL(/c=Snacks/);
  await page.getByRole("heading", { name: /Kettle Chips/ }).waitFor();
  assert.equal(await page.getByRole("heading", { name: /Spring Water/ }).count(), 0);
  await itemRow.getByRole("button", { name: "All" }).click();
  await page.waitForURL((u) => !u.search);
  await brandRow.getByRole("button", { name: "Clear Springs" }).click();
  await page.waitForURL(/b=Clear\+Springs/);
  await page.getByText(/^2 products · Clear Springs$/).waitFor();
  await itemRow.getByRole("button", { name: "Snacks" }).click();
  await page.waitForURL(/b=Clear\+Springs&c=Snacks/);
  await page.getByText("No products match.").waitFor();
  await page.goto(`${APP}/shop/happy`);
  await page.getByRole("searchbox", { name: "Search products" }).fill("cola");
  await page.waitForURL(/q=cola/);
  await page.getByRole("heading", { name: /Cola 24/ }).waitFor();
  assert.equal(await page.getByRole("heading", { name: /Spring Water/ }).count(), 0);
  step("brand and item (category) filters and search");

  // ---- Add to cart (grid quantity + detail page)
  await page.goto(`${APP}/shop/happy`);
  const card = page.locator("article", { has: page.getByRole("heading", { name: "Spring Water 24 × 16.9 oz" }) });
  await card.getByRole("button", { name: /Increase quantity/ }).click();
  await card.getByRole("button", { name: /Increase quantity/ }).click();
  await card.getByRole("button", { name: "Add to Cart" }).click();
  await page.getByRole("link", { name: /Cart, 3 items/ }).waitFor();
  await page.getByRole("heading", { name: /Kettle Chips/ }).click();
  await page.waitForURL(/\/p\//);
  await page.getByRole("link", { name: "← Back to Happy" }).waitFor();
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
  // Not signed in → login screen; signed in but without the order's token → not found.
  assert.match((await fetch(`${APP}/order/${orderId}`, { redirect: "manual" })).headers.get("location") ?? "", /\/login/);
  const noToken = await page.goto(`${APP}/order/${orderId}`);
  assert.equal(noToken.status(), 404);
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
  const sessionCookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
  const q = await (await fetch(`${APP}/api/quote`, { method: "POST", headers: { "content-type": "application/json", cookie: sessionCookie }, body: JSON.stringify({ items: [{ productId, quantity: 1 }] }) })).json();
  const headers = { "content-type": "application/json", origin: APP, cookie: sessionCookie };
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
  await admin.getByText(/1360 products · page 1 of 28/).waitFor();
  await admin.screenshot({ path: join(shots, "08-admin-products.png"), fullPage: true });
  const exported = await admin.request.get(`${APP}/admin/products/export`);
  assert.equal(exported.status(), 200);
  const exportText = await exported.text();
  assert.equal(exportText.trim().split("\r\n").length - 1, 1361, "export includes every product in both catalogs, past 1,000 rows");
  assert.match(exportText, /,happy,,Bulk Item 0700,17\.00,BULK-700,THCA,Mint; Mango/);
  assert.match(exportText, /,vapes,Cloudline,Cloud Disposable 2g,19\.99,CL-2G,Disposables,/);
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

  // ---- Catalogs and brands in admin: tabs, form fields, CSV import by id
  await admin.goto(`${APP}/admin/products?catalog=vapes`);
  await admin.getByRole("link", { name: "Cloud Disposable 2g" }).or(admin.getByText("Cloud Disposable 2g")).first().waitFor();
  assert.equal(await admin.getByText("Energy Drink 24 × 8.4 oz").count(), 0, "Vapes tab lists only Vapes products");
  await admin.screenshot({ path: join(shots, "08b-admin-products-vapes.png"), fullPage: true });
  await admin.goto(`${APP}/admin/products/${created.id}`);
  await admin.getByLabel("Catalog", { exact: true }).selectOption("vapes");
  await admin.getByLabel(/Brand/).fill("Volt");
  await admin.getByRole("button", { name: "Save changes" }).click();
  await admin.waitForURL(/\/admin\/products\?saved=/);
  let [moved] = await sql("select catalog, brand from public.products where id = $1", [created.id]);
  assert.deepEqual({ ...moved }, { catalog: "vapes", brand: "Volt" });
  // Re-importing an export row by id updates that product (even with a new SKU) instead of adding one.
  const csvIn = `id,catalog,brand,name,price,sku,category,description,published\r\n${created.id},happy,Volt Labs,Energy Drink 24 × 8.4 oz,32.50,EN-24B,Beverages,,true\r\n,vapes,Cloudline,Cloud Pod 1g,9.99,CL-1G,Pods,,true\r\n`;
  await admin.goto(`${APP}/admin/products`);
  await admin.getByText("Import / export CSV").click();
  await admin.locator('input[name="file"]').setInputFiles({ name: "products.csv", mimeType: "text/csv", buffer: Buffer.from(csvIn) });
  await admin.getByRole("button", { name: "Import CSV" }).click();
  await admin.getByText("Imported: 1 added, 1 updated.").waitFor();
  [moved] = await sql("select catalog, brand, sku from public.products where id = $1", [created.id]);
  assert.deepEqual({ ...moved }, { catalog: "happy", brand: "Volt Labs", sku: "EN-24B" });
  const [pod] = await sql("select catalog, brand, category from public.products where sku = 'CL-1G'");
  assert.deepEqual({ ...pod }, { catalog: "vapes", brand: "Cloudline", category: "Pods" });
  step("admin: catalog tabs, catalog + brand on the product form, CSV import matches by id and sets catalog/brand");

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
  await loginAs(desk, MAIN_CODE);
  await desk.screenshot({ path: join(shots, "11a-choose-catalog-desktop.png") });
  await desk.goto(`${APP}/shop/happy`);
  await desk.screenshot({ path: join(shots, "11b-happy-desktop.png") });
  await desk.goto(`${APP}/shop/happy?q=Energy%20Drink`);
  await desk.getByRole("heading", { name: /Energy Drink/ }).waitFor();
  await desk.screenshot({ path: join(shots, "11-catalog-desktop.png"), fullPage: true });
  await desk.goto(`${APP}/p/${created.id}`);
  await desk.screenshot({ path: join(shots, "12-product-desktop.png") });
  // Header search on other pages searches every catalog.
  await desk.getByRole("searchbox", { name: "Search all products" }).fill("cloud");
  await desk.getByRole("searchbox", { name: "Search all products" }).press("Enter");
  await desk.waitForURL(/\/search\?q=cloud/);
  await desk.getByRole("heading", { name: "Cloud Disposable 2g" }).waitFor();
  await desk.getByRole("heading", { name: "Cloud Pod 1g" }).waitFor();
  step("header search finds products in every catalog");

  // ---- Admin: manage flavors on a product (add, rename, remove, reorder-free save)
  const [{ id: shotId }] = await sql("select id from public.products where sku = 'ES-12'");
  await admin.goto(`${APP}/admin/products/${shotId}`);
  const flavorList = admin.getByRole("list", { name: "Flavors" });
  await flavorList.waitFor();
  assert.equal(await flavorList.getByRole("listitem").count(), 7);
  await admin.getByLabel("New flavor name").fill("Kiwi");
  await admin.getByRole("button", { name: "Add flavor" }).click();
  await admin.getByLabel("New flavor name").fill("kiwi"); // duplicate (case-insensitive) is refused
  await admin.getByRole("button", { name: "Add flavor" }).click();
  await admin.getByText(/already in the list/).waitFor();
  await admin.getByLabel("New flavor name").fill("");
  await flavorList.getByRole("textbox", { name: "Flavor name" }).first().fill("Mixed Berry");
  await admin.getByRole("button", { name: "Remove Orange" }).click();
  await admin.screenshot({ path: join(shots, "15-admin-flavors.png"), fullPage: true });
  await admin.getByRole("button", { name: "Save changes" }).click();
  await admin.waitForURL(/\/admin\/products\?saved=/);
  const flavorNames = (await sql("select name from public.product_flavors where product_id = $1 order by sort_order", [shotId])).map((f) => f.name);
  assert.deepEqual(flavorNames, ["Mixed Berry", "Lemon Lime", "Grape", "Mango", "Peach", "Watermelon", "Kiwi"]);
  const [{ img: grapeImg }] = await sql("select image_path as img from public.product_flavors where product_id = $1 and name = 'Grape'", [shotId]);
  assert.ok(grapeImg, "flavor images are kept on save");
  step("admin adds, renames and removes flavors on one product (no duplicates, no extra products)");

  // ---- Admin: create a customer and copy the generated code
  await admin.goto(`${APP}/admin/customers`);
  await admin.getByRole("button", { name: "Add Customer" }).click();
  await admin.getByLabel("Customer or business name").fill("Main Street Market");
  await admin.getByRole("button", { name: "Create & generate code" }).click();
  await admin.getByText(/already exists/).waitFor(); // duplicate names refused
  await admin.getByLabel("Customer or business name").fill("Flavor Test Shop");
  await admin.getByRole("button", { name: "Create & generate code" }).click();
  const codeEl = admin.getByTestId("access-code");
  await codeEl.waitFor();
  const flavorCode = (await codeEl.textContent()).trim();
  assert.match(flavorCode, /^[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}$/);
  await admin.getByRole("button", { name: "Copy Code" }).click();
  await admin.screenshot({ path: join(shots, "16-admin-customer-created.png"), fullPage: true });
  const [stored] = await sql("select c.id, c.active, k.code_hash from public.customers c join public.customer_codes k on k.customer_id = c.id where c.name = 'Flavor Test Shop'");
  assert.equal(stored.active, true);
  assert.equal(stored.code_hash, codeHash(flavorCode));
  assert.ok(!JSON.stringify(await sql("select * from public.customer_codes")).includes(flavorCode.replace(/-/g, "")), "codes are stored hashed only");
  step("admin creates a customer; a unique code is generated, shown once with Copy, stored only as a hash");

  // ---- Shopper: code-only login, flavor dropdown, two flavors of one product
  const shopperCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, extraHTTPHeaders: SHOPPER_HEADERS, userAgent: IPHONE_UA });
  const shopper = await shopperCtx.newPage();
  shopper.on("pageerror", (e) => failures.push(`flavor page error: ${e.message}`));
  await loginAs(shopper, flavorCode);
  await shopper.getByText("Flavor Test Shop").first().waitFor({ state: "attached" });
  await shopper.goto(`${APP}/shop/happy`);
  const shotCard = shopper.locator("article", { has: shopper.getByRole("heading", { name: "Energy Shot 2 oz, 12 ct" }) });
  const flavorSelect = shotCard.getByLabel("Flavor");
  const addBtn = shotCard.getByRole("button", { name: "Add to Cart" });
  assert.equal(await addBtn.isDisabled(), true, "a flavor is required first");
  const options = await flavorSelect.locator("option").allTextContents();
  assert.deepEqual(options.slice(1), ["Mixed Berry", "Lemon Lime", "Grape", "Mango", "Peach", "Watermelon", "Kiwi"]);
  assert.equal(await shopper.locator("article").filter({ hasText: "Energy Shot" }).count(), 1, "flavors are not separate products");
  await flavorSelect.selectOption({ label: "Grape" });
  await shotCard.getByText("Selected: Grape").waitFor();
  const imgSrc = await shotCard.locator("img").first().getAttribute("src");
  assert.match(imgSrc ?? "", /flavors%2FGrape|flavors\/Grape/, "flavor image shows when set");
  await shopper.screenshot({ path: join(shots, "13-flavors-mobile.png"), fullPage: true });
  await shotCard.getByRole("button", { name: /Increase quantity/ }).click();
  await addBtn.click();
  await flavorSelect.selectOption({ label: "Peach" });
  await shotCard.getByRole("button", { name: "Add to Cart" }).click();
  await shopper.getByRole("link", { name: /Cart, 3 items/ }).waitFor();
  // Search by flavor name finds the product.
  await shopper.goto(`${APP}/?q=watermelon`);
  await shopper.getByRole("heading", { name: "Energy Shot 2 oz, 12 ct" }).waitFor();
  await shopper.goto(`${APP}/cart`);
  await shopper.getByText("Flavor: Grape").waitFor();
  await shopper.getByText("Flavor: Peach").waitFor();
  assert.equal(await shopper.getByRole("listitem").filter({ hasText: "Energy Shot" }).count(), 2, "two flavors = two cart lines");
  await shopper.screenshot({ path: join(shots, "17-cart-flavors-mobile.png"), fullPage: true });
  step("Flavor dropdown lists only that product's flavors; selection required; two flavors become two cart lines");

  await shopper.goto(`${APP}/checkout`);
  assert.equal(await shopper.getByLabel("Store / Business Name").inputValue(), "Flavor Test Shop", "business name prefilled from the account");
  await shopper.getByText("Flavor: Grape").waitFor();
  await shopper.getByRole("button", { name: "Place Order" }).click();
  await shopper.waitForURL(/\/order\//);
  await shopper.getByRole("heading", { name: "Order Placed Successfully" }).waitFor();
  const invoiceSection = shopper.getByRole("region", { name: "Invoice items" });
  assert.equal(await invoiceSection.locator("img").count(), 2, "each invoice line shows its image");
  await shopper.screenshot({ path: join(shots, "18-confirmation-images-mobile.png"), fullPage: true });
  const flavorOrderUrl = new URL(shopper.url());
  const [flavorOrder] = await sql("select id, customer_id from public.orders where business_name = 'Flavor Test Shop'");
  assert.equal(flavorOrder.customer_id, stored.id, "order linked to the logged-in customer");
  const lines = await sql("select name, flavor_name, quantity, image_path from public.order_items where order_id = $1 order by position", [flavorOrder.id]);
  assert.deepEqual(lines.map((l) => [l.flavor_name, l.quantity]), [["Grape", 2], ["Peach", 1]]);
  assert.match(lines[0].image_path, /flavors\/Grape/, "flavor-specific image snapshotted");
  assert.match(lines[1].image_path, /seed\.png$/, "no flavor image → product image");
  const flavorPdf = new Uint8Array(await (await fetch(`${APP}/api/invoice/${flavorOrder.id}?t=${flavorOrderUrl.searchParams.get("t")}`)).arrayBuffer());
  const imageObjects = (Buffer.from(flavorPdf).toString("latin1").match(/\/Subtype\s*\/Image/g) ?? []).length;
  assert.ok(imageObjects >= 2, `PDF embeds product images (found ${imageObjects})`);
  writeFileSync(join(shots, "invoice-with-images.pdf"), flavorPdf);
  // Changing flavors later doesn't touch the order or its stored invoice.
  await sql("update public.product_flavors set name = 'Grape Soda' where product_id = $1 and name = 'Grape'", [shotId]);
  const flavorPdfAgain = new Uint8Array(await (await fetch(`${APP}/api/invoice/${flavorOrder.id}?t=${flavorOrderUrl.searchParams.get("t")}`)).arrayBuffer());
  assert.deepEqual(Buffer.from(flavorPdfAgain), Buffer.from(flavorPdf));
  const [{ flavor_name: kept }] = await sql("select flavor_name from public.order_items where order_id = $1 order by position limit 1", [flavorOrder.id]);
  assert.equal(kept, "Grape");
  step("checkout, confirmation, PDF invoice and WhatsApp-ready order all carry flavor + product images; history unchanged by later edits");

  // ---- Out of stock: whole product, then a single flavor
  await admin.goto(`${APP}/admin/products?q=Energy%20Shot`);
  const shotRow = admin.getByRole("row", { name: /Energy Shot 2 oz, 12 ct/ });
  await shotRow.getByRole("button", { name: "In stock" }).click();
  await shotRow.getByRole("button", { name: "Out of stock" }).waitFor();
  const [{ in_stock: shotStock }] = await sql("select in_stock from public.products where id = $1", [shotId]);
  assert.equal(shotStock, false);
  await shopper.goto(`${APP}/?q=energy%20shot`);
  const oosCard = shopper.locator("article", { has: shopper.getByRole("heading", { name: "Energy Shot 2 oz, 12 ct" }) });
  await oosCard.getByText("Out of stock", { exact: true }).waitFor();
  assert.equal(await oosCard.getByRole("button", { name: "Out of Stock" }).isDisabled(), true, "out-of-stock product can't be added");
  await shopper.screenshot({ path: join(shots, "21-out-of-stock-mobile.png"), fullPage: true });
  const [{ id: mangoId }] = await sql("select id from public.product_flavors where product_id = $1 and name = 'Mango'", [shotId]);
  const staleQuote = await (await shopper.request.post(`${APP}/api/quote`, { data: { items: [{ productId: shotId, flavorId: mangoId, quantity: 1 }] } })).json();
  assert.equal(staleQuote.quote.unavailable[0].reason, "out_of_stock", "the server refuses an out-of-stock item already in a cart");
  await shotRow.getByRole("button", { name: "Out of stock" }).click();
  await shotRow.getByRole("button", { name: "In stock" }).waitFor();

  await admin.goto(`${APP}/admin/products/${shotId}`);
  await admin.getByRole("button", { name: "Kiwi: in stock" }).click();
  await admin.getByRole("button", { name: "Kiwi: out of stock" }).waitFor();
  await admin.getByText(/1 out of stock/).first().waitFor();
  await admin.getByRole("button", { name: /^Save/ }).click();
  await admin.waitForURL(/\/admin\/products\?saved=/);
  await admin.getByText(/1 out of stock/).first().waitFor();
  await shopper.goto(`${APP}/?q=energy%20shot`);
  const kiwiOption = oosCard.getByLabel("Flavor").locator("option", { hasText: "Kiwi — out of stock" });
  assert.equal(await kiwiOption.isDisabled(), true, "out-of-stock flavor can't be chosen");
  await oosCard.getByText(/6 of 7 available/).waitFor({ state: "attached" });
  await oosCard.getByLabel("Flavor").selectOption({ label: "Mango" });
  assert.equal(await oosCard.getByRole("button", { name: "Add to Cart" }).isDisabled(), false, "other flavors still orderable");
  step("products and single flavors can be marked out of stock: shown to customers, can't be added, refused by the server");

  // ---- Logout ends the session
  await shopper.getByRole("button", { name: "Log out" }).click();
  await shopper.waitForURL(/\/login\?reason=logout/);
  await shopper.goto(`${APP}/cart`);
  await shopper.waitForURL(/\/login/);

  // ---- Regenerate: old code + old sessions stop working immediately
  const shopper2 = await browser.newPage({ extraHTTPHeaders: SHOPPER_HEADERS });
  await loginAs(shopper2, flavorCode);
  await admin.goto(`${APP}/admin/customers/${stored.id}`);
  admin.once("dialog", (d) => d.accept());
  await admin.getByRole("button", { name: "Regenerate code" }).click();
  const newCodeEl = admin.getByTestId("access-code");
  await newCodeEl.waitFor();
  const newCode = (await newCodeEl.textContent()).trim();
  assert.notEqual(newCode, flavorCode);
  await shopper2.goto(`${APP}/cart`);
  await shopper2.waitForURL(/\/login\?reason=ended/);
  await shopper2.getByLabel("Access Code").fill(flavorCode);
  await shopper2.getByRole("button", { name: "Login" }).click();
  await shopper2.getByText(/no longer valid/).waitFor();
  await loginAs(shopper2, newCode);
  step("regenerating a code revokes the old code and signs out existing sessions");

  // ---- Deactivate: immediate loss of access; reactivate restores it
  await admin.reload();
  admin.once("dialog", (d) => d.accept());
  await admin.getByRole("button", { name: "Deactivate" }).click();
  await admin.getByRole("button", { name: "Activate" }).waitFor();
  await shopper2.goto(`${APP}/`);
  await shopper2.waitForURL(/\/login/);
  await shopper2.getByLabel("Access Code").fill(newCode);
  await shopper2.getByRole("button", { name: "Login" }).click();
  await shopper2.getByText(/inactive/).waitFor();
  await admin.getByRole("button", { name: "Activate" }).click();
  await admin.getByRole("button", { name: "Deactivate" }).waitFor();
  await loginAs(shopper2, newCode);
  step("deactivation blocks the customer immediately; reactivation restores access");

  // ---- Customer login history
  await admin.reload();
  const history = admin.getByRole("table").last();
  await history.getByText("Logged out").first().waitFor();
  await history.getByText("Ended: code regenerated").first().waitFor();
  await history.getByText("Ended: account deactivated").first().waitFor();
  await history.getByText("Failed · Revoked code").first().waitFor();
  await history.getByText("Philadelphia, PA, US").first().waitFor();
  await history.getByText("203.0.113.10").first().waitFor();
  await history.getByText(/Mobile · Safari 17\.4 · iOS/).first().waitFor();
  await admin.screenshot({ path: join(shots, "19-admin-customer-detail.png"), fullPage: true });
  step("customer page shows login history with session outcomes, IP, approximate location and device");

  // ---- Login Activity dashboard
  await admin.goto(`${APP}/admin/activity`);
  const [{ n: successes }] = await sql("select count(*)::int as n from public.login_events where success");
  const [{ n: fails }] = await sql("select count(*)::int as n from public.login_events where not success");
  await admin.getByText("Successful logins").locator("..").getByText(String(successes), { exact: true }).waitFor();
  await admin.getByText("Failed attempts").locator("..").getByText(String(fails), { exact: true }).waitFor();
  await admin.screenshot({ path: join(shots, "20-admin-activity.png"), fullPage: true });
  await admin.getByRole("link", { name: "Failed", exact: true }).click();
  await admin.waitForURL(/result=failed/);
  assert.equal(await admin.getByText("Success", { exact: true }).count(), 0, "failed filter shows failures only");
  await admin.getByText("Failed · Invalid code").first().waitFor();
  await admin.getByLabel("Customer").fill("Flavor Test");
  await admin.getByRole("button", { name: "Filter" }).click();
  await admin.waitForURL(/q=Flavor/);
  await admin.getByText("Failed · Revoked code").first().waitFor();
  assert.equal(await admin.getByText("Failed · Invalid code").count(), 0, "customer filter applied");
  await admin.getByRole("link", { name: "Flavor Test Shop" }).first().click();
  await admin.waitForURL(new RegExp(`/admin/customers/${stored.id}`));
  // Date filter far in the past → nothing.
  await admin.goto(`${APP}/admin/activity?from=2000-01-01&to=2000-01-02`);
  await admin.getByText("No login activity matches these filters.").waitFor();
  const failedRows = await sql("select * from public.login_events where not success");
  assert.ok(!JSON.stringify(failedRows).includes("ABCDEFGHJKMNPQRS"), "submitted codes are never stored");
  step("Login Activity: real totals, success/failed filter, customer search, date range, link to account; codes never logged");

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
