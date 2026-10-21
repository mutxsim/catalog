# Catalog & WhatsApp Ordering

A minimal wholesale catalog. Customers browse, fill a cart and place an order with only their **store / business name** — no accounts, no online payment. Every order gets a sequential invoice number and a PDF invoice, and the same PDF is sent to your WhatsApp. Customers pay and pick up in store.

No branding is built in: business name, logo, address, currency, tax and invoice text all come from **Admin → Settings**.

**Stack:** Next.js 16 · TypeScript · Tailwind CSS 4 · Supabase (Postgres, Auth, Storage) · pdf-lib · WhatsApp Business Cloud API

---

## Setup (about 15 minutes)

### 1. Create a Supabase project
At [supabase.com](https://supabase.com) create a project (the free tier is fine).

### 2. Create the database
In the Supabase dashboard open **SQL Editor**, paste the whole of `supabase/migrations/0001_init.sql`, and run it. Then do the same with `supabase/migrations/0002_flavors.sql` (adds flavors; safe to run on a database that already has products and orders). This creates the tables, pricing/order functions, row-level security and the three storage buckets (`product-images`, `branding` public; `invoices` private).

Then in **Authentication → Sign In / Providers**, turn **off** "Allow new users to sign up". Only the admin account you create below should exist.

### 3. Configure environment variables
```bash
cp .env.example .env.local
```
From **Project Settings → API** fill in `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`. The secret key stays on the server; it is never sent to browsers.

### 4. Install, create your admin login, run
```bash
npm install
npm run create-admin -- you@example.com 'a-long-password'
npm run dev
```
Open http://localhost:3000/admin, sign in, then:
1. **Settings** — business name, logo, address, WhatsApp number (with country code), currency, invoice prefix, tax, pickup instructions, footer.
2. **Products** — add products with prices and images, or import a CSV.
3. Share your site's root URL (`https://your-domain/`) with customers.

### 5. Deploy
Deploy to Vercel (or any Node host): import the repo, add the same environment variables, deploy. Use Node 20.9+.

---

## How it works

| Customer | You |
|---|---|
| Browses `/` — search, category filters, product detail pages | Manage products, order and visibility at `/admin/products` |
| Cart is saved in the browser; totals are re-priced by the server | New orders arrive on WhatsApp with the PDF attached |
| Checkout asks only for the store/business name → **Place Order** | `/admin/orders`: open, change status, download or print invoices, retry WhatsApp |
| Confirmation page with order number, total and **Download Invoice** | Statuses: New → Preparing → Ready for Pickup → Completed / Cancelled |

### Order integrity
- **Prices are never taken from the browser.** One database function (`quote_items`) prices carts for display and for orders. If prices change between page load and submit, the order is refused and the customer sees the new total.
- **Orders are created atomically** by `place_order()`: validation, pricing, tax, invoice number and line-item snapshot in one transaction.
- **Duplicate submissions** (double taps, retries, flaky connections) reuse one submission key per cart, so at most one order is created.
- **Invoice numbers are sequential and gapless** (`INV-001001`, `INV-001002`, …). The prefix applies to new invoices.
- **Invoices are immutable.** Line items, prices, tax and your business details are snapshotted at checkout; database triggers block changes. Editing or deleting a product never alters a past invoice. Cancelled orders keep their records.
- **The PDF is generated and stored before WhatsApp is contacted**, and the stored file is what the customer downloads, what WhatsApp receives and what you reprint — byte-for-byte the same. ("Reprint showing current status" renders a copy with today's status for convenience.)
- If WhatsApp is down, the order is still saved; the failure is recorded and you can **Retry send**.

### Privacy
Only the business name is collected, stored on the order itself. There are no customer accounts, profiles, contact lists or marketing data. Client IPs are never stored — only a salted hash, for rate limiting, deleted after a day. Invoice links contain a long random token; order numbers alone can't open them.

Records are kept for the number of years set in Settings (default 7). **Nothing is deleted automatically.** Settings → *Remove expired records* deletes only completed or cancelled orders older than that period — check your accounting obligations first.

---

## WhatsApp

Without WhatsApp configured, everything else works: orders are saved and appear in Admin, and the confirmation page offers customers a **Send order on WhatsApp** button. That opens WhatsApp with the order text filled in — the customer must press Send, and **no PDF is attached**. It is a convenience, not automatic delivery.

### Automatic delivery with the PDF (WhatsApp Business Cloud API)
1. In [Meta for Developers](https://developers.facebook.com/) create an app (type **Business**) and add the **WhatsApp** product.
2. Register a business phone number. This is the *sending* number and must differ from your personal WhatsApp number in Settings.
3. Create a **System User** in Meta Business Settings with `whatsapp_business_messaging` permission and generate a permanent access token.
4. Set `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` (shown under WhatsApp → API Setup).
5. **Create a message template (strongly recommended).** WhatsApp only allows free-form messages to a number that messaged your business number in the last 24 hours. Templates can be sent any time. In WhatsApp Manager create a **Utility** template:
   - **Header:** Document
   - **Body:** `New wholesale order #{{1}} from {{2}}. Total due: {{3}}. Items: {{4}}. Payment: in-store. Invoice attached.`

   Once approved, set `WHATSAPP_TEMPLATE_NAME` (and `WHATSAPP_TEMPLATE_LANGUAGE` if not `en_US`). Without a template, the app sends the full order summary as the PDF's caption — which works only inside the 24-hour window.
6. **Delivery confirmation (optional).** Under WhatsApp → Configuration set the callback URL to `https://your-domain/api/whatsapp/webhook`, choose a verify token, and subscribe to the `messages` field. Set `WHATSAPP_WEBHOOK_VERIFY_TOKEN` and `WHATSAPP_APP_SECRET` (App Settings → Basic).

**What the statuses mean** (Admin → order): *Accepted by WhatsApp* means the API accepted the message. It only shows *Sent*, *Delivered* or *Read* once WhatsApp confirms it through the webhook. *Failed* shows WhatsApp's error and a **Retry send** button. The app never reports delivery it hasn't been told about.

Admin → Settings shows which parts are configured.

---

## Flavors / varieties
To sell one product in several flavors, add each flavor as its own product (own price, SKU and photo) and give them the same **Product group**, with the flavor in **Flavor / variety** (Admin → Products → Add product). For example: group `Gummies 10ct`, flavors `Mango`, `Watermelon`, `Blue Razz`.

The catalog then shows one card for the group with flavor chips (and a flavor dropdown when there are more than six). The selected flavor sets the photo, SKU, price and what goes in the cart. The cart, invoice and WhatsApp message name the flavor, e.g. "Gummies 10ct — Mango". Searching for a flavor shows its group with that flavor selected. Products without a group show as before.

## Product CSV
Admin → Products → *Import / export CSV*. Columns: `name, price, sku, category, group, flavor, description, published, sort_order` (only `name` and `price` are required). Rows whose SKU matches an existing product update it; others are added. Images are set per product.

## Testing
```bash
npm test            # unit + database tests (runs the real migration in in-process Postgres)
npm run typecheck
npm run lint
npm run build:e2e && npm run test:e2e   # full browser test against a local Supabase stand-in
```
The end-to-end test needs Chromium: run `npx playwright install chromium` once, or set `CHROME_PATH`. It walks through browsing, cart, a stale-price rejection, ordering, invoice download and access control, WhatsApp delivery of the identical PDF, duplicate-submission protection, admin login, status changes, retry, product creation with image validation and settings. Run `npm run build` again before deploying, since `build:e2e` builds against the local stand-in.

## Project layout
```
supabase/migrations/0001_init.sql   schema, pricing & order functions, RLS, buckets
src/app/(store)/                    catalog, product, cart, checkout, confirmation
src/app/admin/                      login + orders, products, settings
src/app/api/                        quote, orders, invoice download, WhatsApp webhook
src/lib/invoice/                    PDF rendering and storage
src/lib/whatsapp/                   message text, Cloud API client, notifier
src/proxy.ts                        admin session refresh / redirect
tests/                              unit, database and end-to-end tests
```
