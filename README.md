# Catalog & WhatsApp Ordering

A minimal wholesale catalog. Customers browse, fill a cart and place an order with only their **store / business name** — no accounts, no online payment. Every order gets a sequential invoice number and a PDF invoice, and the same PDF is sent to your WhatsApp. Customers pay and pick up in store.

No branding is built in: business name, logo, address, currency, tax and invoice text all come from **Admin → Settings**.

**Stack:** Next.js 16 · TypeScript · Tailwind CSS 4 · Supabase (Postgres, Auth, Storage) · pdf-lib · WhatsApp Business Cloud API

---

## Setup (about 15 minutes)

### 1. Create a Supabase project
At [supabase.com](https://supabase.com) create a project (the free tier is fine).

### 2. Create the database
In the Supabase dashboard open **SQL Editor**, paste the whole of `supabase/migrations/0001_init.sql`, and run it. Then do the same with `supabase/migrations/0002_flavors.sql`, `supabase/migrations/0003_flavors_customers_activity.sql`, `supabase/migrations/0004_image_source_url.sql` and `supabase/migrations/0005_stock.sql`, in that order. They only add things; existing products, orders and invoices are untouched. This creates the tables, pricing/order functions, row-level security and the three storage buckets (`product-images`, `branding` public; `invoices` private).

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

## Flavors
Open a product in **Admin → Products** and use the **Flavors** box: type a name and press **Add flavor**, edit names in place, use ▲▼ to reorder, **Remove** to delete one, and tap the square to give a flavor its own photo (otherwise the product photo is used). Everything is saved with **Save changes**. Price and SKU come from the product; flavors are not separate products.

Customers see a **Flavor** dropdown on that product and must choose one before **Add to Cart** (a single flavor is selected automatically). The same product in two flavors becomes two cart lines. Cart, checkout, the invoice and the WhatsApp message all show the flavor. Search also matches flavor names. Renaming or removing a flavor later never changes past orders — each order line stores the flavor name and image it was sold with.

## Customer access codes
The catalog is private: customers enter an **Access Code** at `/login` — no name, email or password.

1. **Admin → Customers → Add Customer**, enter the business name. A random code like `K7QM-2XTR-9HBD-PW4C` (~78 bits) is generated and shown **once** with **Copy Code**. Codes are stored only as SHA-256 hashes, so they can't be shown again; use **Regenerate code** if one is lost.
2. Send the code to the customer. They log in with it; their business name is prefilled at checkout and their orders are linked to their account.
3. On the customer's page you can rename, **Regenerate code** (old code stops working and open sessions end immediately), **Deactivate/Activate** (deactivation signs them out at once), or **Delete account** (soft delete: access ends, past orders, invoices and login history are kept).

**Sessions:** a random 256-bit token in an HttpOnly, Secure, SameSite=Lax cookie; only its hash is stored. Sessions end on logout, after 7 days of inactivity, or 30 days after login. Every customer page and API checks the session in the database; nothing relies on browser-side checks.

**Rate limiting:** 10 failed attempts per IP address within 15 minutes blocks that IP for the rest of the window (other customers are unaffected). Set `LOGIN_RATE_LIMIT` to change it.

## Login Activity
**Admin → Login Activity** lists every attempt (successful and failed) with totals for successful logins, unique customers, the most recent login and failed attempts. Filter by customer, date range, result and device; click a name to open the account. Each customer's page has its own **Login history** with session status (Active, Logged out, Expired, Ended: code regenerated/account deactivated).

Recorded per attempt (server-side only): time (UTC, shown in `STORE_TIMEZONE`), customer, IP address, approximate city/region/country, device type, browser + version, OS, result and failure reason (invalid code, revoked code, inactive account, rate limited). **The code entered is never stored.** Missing details show as Unknown — nothing is guessed. A session is never shown as "logged out" unless the customer pressed Log out.

**Location** comes from Vercel's built-in IP geolocation headers (`x-vercel-ip-city`, `-country-region`, `-country`): free, no third-party service, and the IP is not sent anywhere else. It's approximate and can reflect a VPN, mobile carrier or office network. On other hosts location shows as Unknown unless your platform adds those headers; if you run behind your own proxy, set `TRUSTED_IP_HEADER` to the header it sets with the client IP.

**Retention:** login records are kept for `Settings → Keep login records for (days)` (default 365) and removed only when you press **Login Activity → Retention → Remove old login records**.

## Out of stock
Mark a whole product out of stock with the **In stock / Out of stock** button in the Products list (or the **In stock** checkbox on the product's page). Mark a single flavor out of stock with its **In stock** button in the product's flavor list, then save.

Customers still see out-of-stock items: the product shows an **Out of stock** badge and its button reads **Out of Stock**; an out-of-stock flavor appears in the dropdown as "Mango — out of stock" and can't be picked. If something goes out of stock while it's already in a cart, the cart marks that line and checkout is refused until it's removed — the server checks stock on every order. The CSV has an `in_stock` column (true/false); leave it empty to keep the current stock.

## Importing product photos from links
The product CSV has an optional `image_url` column. On import, each link is downloaded on the server, converted to WebP (max 1200px) and becomes the product photo. Only public `http(s)` links are accepted — links to private/internal addresses are refused — and each image must be under 10 MB. Imports spend at most about 3½ minutes downloading; if a big file isn't finished, the message says how many are left, and running the same import again continues (links already imported for a product are skipped). Rows whose link fails are listed in the import message and keep their current photo. Uploading a photo by hand later replaces the imported one. Export includes the `image_url` column (the original link, or the stored photo's URL).

## Invoice images
Each invoice line shows a small thumbnail of the product (or the selected flavor's own photo) next to the name and flavor — in the PDF (download and print) and on the order confirmation page. The image used is recorded on the order line at checkout, and images referenced by past orders are never deleted from storage, so old invoices keep their pictures. Missing or unreadable images show a neutral placeholder; images are shrunk server-side (sharp) before being embedded. The PDF is generated once at checkout and stored, so reopening it later always gives the same file.

## Product CSV
Admin → Products → *Import / export CSV*. Columns: `name, price, sku, category, flavors, description, published, sort_order`. `flavors` lists names separated by semicolons (`Mint; Grape; Mango`); a filled cell replaces that product's flavor list, an empty cell leaves it unchanged. (only `name` and `price` are required). Rows whose SKU matches an existing product update it; others are added. Images are set per product.

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
