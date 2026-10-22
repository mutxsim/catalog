/**
 * Runs every supabase/migrations/*.sql file against an in-process Postgres
 * (PGlite) with minimal stand-ins for Supabase's auth/storage schemas, then
 * exercises pricing, ordering, idempotency and immutability rules.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const SUPABASE_STUBS = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema storage;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.role', true), '') $$;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
`;

let db: PGlite;
const token = () => "t".repeat(8) + randomUUID().replace(/-/g, "") ; // 40 chars, [A-Za-z0-9]

async function addProduct(name: string, cents: number, opts: { published?: boolean; sku?: string } = {}) {
  const r = await db.query<{ id: string }>(
    "insert into public.products (name, price_cents, published, sku) values ($1, $2, $3, $4) returning id",
    [name, cents, opts.published ?? true, opts.sku ?? null],
  );
  return r.rows[0].id;
}

async function quote(items: unknown) {
  const r = await db.query<{ q: Record<string, unknown> }>("select public.quote_items($1::jsonb) as q", [JSON.stringify(items)]);
  return r.rows[0].q as {
    lines: { product_id: string; quantity: number; line_total_cents: number }[];
    unavailable: { product_id: string; flavor_id: string | null; reason: string }[];
    subtotal_cents: number; tax_cents: number; total_cents: number;
  };
}

async function place(name: string, items: unknown, expected: number, key = randomUUID(), clientHash: string | null = null) {
  const r = await db.query<{ order_id: string; order_number: string; access_token: string; created: boolean }>(
    "select * from public.place_order($1, $2::jsonb, $3::uuid, $4, $5, $6)",
    [name, JSON.stringify(items), key, token(), expected, clientHash],
  );
  return r.rows[0];
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  const dir = join(__dirname, "..", "supabase", "migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) await db.exec(readFileSync(join(dir, f), "utf8"));
});

describe("quote_items", () => {
  it("prices from the database, merges duplicates, flags unavailable products", async () => {
    const a = await addProduct("Water 24pk", 1299);
    const b = await addProduct("Hidden", 500, { published: false });
    const q = await quote([
      { product_id: a, quantity: 2 },
      { product_id: a, quantity: 1, price_cents: 1 }, // browser-sent price is ignored
      { product_id: b, quantity: 1 },
    ]);
    expect(q.lines).toHaveLength(1);
    expect(q.lines[0].quantity).toBe(3);
    expect(Number(q.subtotal_cents)).toBe(3897);
    expect(q.unavailable).toEqual([{ product_id: b, flavor_id: null, reason: "unavailable" }]);
  });

  it("rejects malformed input", async () => {
    const a = await addProduct("Soda", 100);
    for (const bad of [[], [{ product_id: a, quantity: 0 }], [{ product_id: a, quantity: 1.5 }], [{ product_id: "x", quantity: 1 }], [{ quantity: 1 }], [{ product_id: a, quantity: "2" }], {}]) {
      await expect(quote(bad)).rejects.toThrow(/INVALID_ITEMS/);
    }
  });

  it("applies tax with half-up rounding when enabled", async () => {
    await db.exec("update public.settings set tax_enabled = true, tax_rate = 6.625");
    const a = await addProduct("Chips", 1000);
    const q = await quote([{ product_id: a, quantity: 3 }]); // 3000 * 6.625% = 198.75 -> 199
    expect(Number(q.tax_cents)).toBe(199);
    expect(Number(q.total_cents)).toBe(3199);
    await db.exec("update public.settings set tax_enabled = false, tax_rate = 0");
  });
});

describe("place_order", () => {
  it("creates an order with snapshot lines and gapless invoice numbers", async () => {
    await db.exec("update public.settings set invoice_prefix = 'WO-', business_name = 'Seller Co'");
    const a = await addProduct("Juice", 250, { sku: "JU-1" });
    const first = await place("  Corner   Store ", [{ product_id: a, quantity: 4 }], 1000);
    expect(first.created).toBe(true);
    const o = (await db.query<Record<string, unknown>>("select * from public.orders where id = $1", [first.order_id])).rows[0];
    expect(o.business_name).toBe("Corner Store");
    expect(Number(o.total_cents)).toBe(1000);
    expect(o.invoice_number).toBe(`WO-${first.order_number}`);
    expect((o.seller as { business_name: string }).business_name).toBe("Seller Co");

    // A failed order (price changed) must not consume an invoice number.
    await expect(place("Shop", [{ product_id: a, quantity: 1 }], 1)).rejects.toThrow(/PRICE_CHANGED/);
    const second = await place("Shop", [{ product_id: a, quantity: 1 }], 250);
    expect(Number(second.order_number)).toBe(Number(first.order_number) + 1);
  });

  it("is idempotent on the submission key", async () => {
    const a = await addProduct("Gum", 99);
    const key = randomUUID();
    const one = await place("Dup Shop", [{ product_id: a, quantity: 1 }], 99, key);
    const two = await place("Dup Shop", [{ product_id: a, quantity: 1 }], 99, key);
    expect(two.created).toBe(false);
    expect(two.order_id).toBe(one.order_id);
    const n = await db.query<{ n: number }>("select count(*)::int as n from public.orders where business_name = 'Dup Shop'");
    expect(n.rows[0].n).toBe(1);
  });

  it("validates business name and availability", async () => {
    const a = await addProduct("Candy", 50);
    await expect(place("   ", [{ product_id: a, quantity: 1 }], 50)).rejects.toThrow(/INVALID_BUSINESS_NAME/);
    await expect(place("x".repeat(121), [{ product_id: a, quantity: 1 }], 50)).rejects.toThrow(/INVALID_BUSINESS_NAME/);
    await db.query("update public.products set published = false where id = $1", [a]);
    await expect(place("Shop", [{ product_id: a, quantity: 1 }], 50)).rejects.toThrow(/ITEMS_UNAVAILABLE/);
  });

  it("rate limits per client", async () => {
    const a = await addProduct("Mint", 10);
    for (let i = 0; i < 10; i++) await place("RL", [{ product_id: a, quantity: 1 }], 10, randomUUID(), "client-1");
    await expect(place("RL", [{ product_id: a, quantity: 1 }], 10, randomUUID(), "client-1")).rejects.toThrow(/RATE_LIMITED/);
    await expect(place("RL", [{ product_id: a, quantity: 1 }], 10, randomUUID(), "client-2")).resolves.toBeTruthy();
  });
});

describe("immutability", () => {
  it("keeps invoiced data fixed while allowing status and delivery updates", async () => {
    const a = await addProduct("Tea", 300);
    const o = await place("Immut", [{ product_id: a, quantity: 2 }], 600);

    await expect(db.query("update public.orders set total_cents = 1 where id = $1", [o.order_id])).rejects.toThrow(/ORDER_IMMUTABLE|check/);
    await expect(db.query("update public.orders set business_name = 'X' where id = $1", [o.order_id])).rejects.toThrow(/ORDER_IMMUTABLE/);
    await expect(db.query("update public.order_items set unit_price_cents = 1 where order_id = $1", [o.order_id])).rejects.toThrow(/IMMUTABLE|check/);

    await db.query("update public.orders set status = 'preparing', invoice_path = 'a.pdf' where id = $1", [o.order_id]);
    await expect(db.query("update public.orders set invoice_path = 'b.pdf' where id = $1", [o.order_id])).rejects.toThrow(/INVOICE_IMMUTABLE/);

    // Editing or deleting the product never touches the order's snapshot.
    await db.query("update public.products set price_cents = 999, name = 'Renamed' where id = $1", [a]);
    await db.query("delete from public.products where id = $1", [a]);
    const item = (await db.query<{ name: string; unit_price_cents: number; product_id: string | null }>(
      "select name, unit_price_cents, product_id from public.order_items where order_id = $1", [o.order_id])).rows[0];
    expect(item).toEqual({ name: "Tea", unit_price_cents: 300, product_id: null });
  });
});

describe("whatsapp claim", () => {
  it("only one sender can claim an order at a time", async () => {
    const a = await addProduct("Ice", 100);
    const o = await place("Claim", [{ product_id: a, quantity: 1 }], 100);
    const c1 = await db.query<{ ok: boolean }>("select public.claim_whatsapp_send($1) as ok", [o.order_id]);
    const c2 = await db.query<{ ok: boolean }>("select public.claim_whatsapp_send($1) as ok", [o.order_id]);
    expect(c1.rows[0].ok).toBe(true);
    expect(c2.rows[0].ok).toBe(false);
  });
});

describe("flavors (0002)", () => {
  it("names order lines with the flavor and blocks duplicate flavors in a group", async () => {
    const r = await db.query<{ id: string }>(
      "insert into public.products (name, price_cents, published, group_name, variant_name) values ('Gummies 10ct', 500, true, 'Gummies 10ct', 'Mango'), ('Gummies 10ct Watermelon', 500, true, 'Gummies 10ct', 'Watermelon') returning id",
    );
    const q = await quote(r.rows.map((x) => ({ product_id: x.id, quantity: 1 })));
    const names = (q.lines as unknown as { name: string }[]).map((l) => l.name);
    expect(names).toEqual(["Gummies 10ct — Mango", "Gummies 10ct Watermelon"]);
    await expect(
      db.query("insert into public.products (name, price_cents, group_name, variant_name) values ('X', 1, 'gummies 10CT', 'mango')"),
    ).rejects.toThrow(/products_group_variant_key|duplicate/);
    const o = await place("Flavor Shop", [{ product_id: r.rows[0].id, quantity: 2 }], 1000);
    const item = (await db.query<{ name: string }>("select name from public.order_items where order_id = $1", [o.order_id])).rows[0];
    expect(item.name).toBe("Gummies 10ct — Mango");
  });
});

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("product flavors (0003)", () => {
  it("prices flavors from the parent, splits flavors into lines, snapshots flavor + image", async () => {
    const pid = await addProduct("Vape 5000", 1500, { sku: "VP-5" });
    await db.query("update public.products set image_path = 'products/p.png' where id = $1", [pid]);
    const f = await db.query<{ id: string; name: string }>(
      "insert into public.product_flavors (product_id, name, image_path, sort_order) values ($1, 'Mint', 'flavors/mint.png', 1), ($1, 'Grape', null, 2) returning id, name",
      [pid],
    );
    const mint = f.rows.find((r) => r.name === "Mint")!.id;
    const grape = f.rows.find((r) => r.name === "Grape")!.id;

    // No flavor chosen for a product that has flavors -> not orderable.
    const missing = await quote([{ product_id: pid, quantity: 1 }]);
    expect(missing.unavailable[0].reason).toBe("flavor_required");
    // Flavor from another product -> rejected.
    const other = await addProduct("Other", 100);
    const bad = await quote([{ product_id: other, flavor_id: mint, quantity: 1 }]);
    expect(bad.unavailable[0].reason).toBe("flavor_unavailable");

    const q = await quote([
      { product_id: pid, flavor_id: mint, quantity: 2 },
      { product_id: pid, flavor_id: grape, quantity: 1 },
      { product_id: pid, flavor_id: mint, quantity: 1 },
    ]);
    const lines = q.lines as unknown as { flavor_name: string; quantity: number; image_path: string; line_total_cents: number }[];
    expect(lines.map((l) => [l.flavor_name, l.quantity, l.image_path])).toEqual([
      ["Mint", 3, "flavors/mint.png"],
      ["Grape", 1, "products/p.png"], // no flavor image -> parent image
    ]);
    expect(Number(q.subtotal_cents)).toBe(6000);

    const o = await place("Flavor Buyer", [
      { product_id: pid, flavor_id: mint, quantity: 3 },
      { product_id: pid, flavor_id: grape, quantity: 1 },
    ], 6000);
    // Removing/renaming flavors later never changes the order.
    await db.query("update public.product_flavors set name = 'Cool Mint' where id = $1", [mint]);
    await db.query("delete from public.product_flavors where id = $1", [grape]);
    const items = (await db.query<{ flavor_name: string; flavor_id: string | null; image_path: string | null }>(
      "select flavor_name, flavor_id, image_path from public.order_items where order_id = $1 order by position", [o.order_id])).rows;
    expect(items).toEqual([
      { flavor_name: "Mint", flavor_id: mint, image_path: "flavors/mint.png" },
      { flavor_name: "Grape", flavor_id: null, image_path: "products/p.png" },
    ]);
    await expect(db.query("update public.order_items set flavor_name = 'X' where order_id = $1", [o.order_id])).rejects.toThrow(/IMMUTABLE/);
    await expect(
      db.query("insert into public.product_flavors (product_id, name) values ($1, ' cool mint ')", [pid]),
    ).rejects.toThrow(/product_flavors_name_key|duplicate/);
  });
});

describe("customer access codes (0003)", () => {
  const login = async (code: string, ip = "203.0.113.5") => {
    const token = randomUUID();
    const r = await db.query<{ status: string; customer_id: string | null; session_id: string | null }>(
      "select * from public.customer_login($1, $2, $3, 'UA', 'mobile', 'Safari', '17.0', 'iOS', 'Philadelphia', 'Pennsylvania', 'US')",
      [sha(code), sha(token), ip],
    );
    return { ...r.rows[0], token };
  };
  const session = async (token: string) =>
    (await db.query<{ status: string; customer_name: string | null }>("select * from public.customer_session($1)", [sha(token)])).rows[0];

  it("logs in with a code only, tracks sessions, and invalidates on regenerate/deactivate/delete", async () => {
    const cid = (await db.query<{ id: string }>("select public.create_customer('Corner Deli', $1, 'AB12') as id", [sha("CODE-ONE")])).rows[0].id;
    await expect(db.query("select public.create_customer(' corner deli ', $1, 'X')", [sha("OTHER")])).rejects.toThrow(/customers_name_key|duplicate/);

    const ok = await login("CODE-ONE");
    expect(ok.status).toBe("ok");
    expect(ok.customer_id).toBe(cid);
    expect(await session(ok.token)).toMatchObject({ status: "active", customer_name: "Corner Deli" });
    const ev = (await db.query("select success, device_type, browser, os, city, ip, customer_id from public.login_events where session_id = $1", [ok.session_id])).rows[0];
    expect(ev).toEqual({ success: true, device_type: "mobile", browser: "Safari", os: "iOS", city: "Philadelphia", ip: "203.0.113.5", customer_id: cid });

    // Logout ends the session.
    await db.query("select public.customer_logout($1)", [sha(ok.token)]);
    expect((await session(ok.token)).status).toBe("ended");

    // Regenerating revokes the old code and ends live sessions.
    const s2 = await login("CODE-ONE");
    await db.query("select public.regenerate_customer_code($1, $2, 'CD34')", [cid, sha("CODE-TWO")]);
    expect((await session(s2.token)).status).toBe("ended");
    expect((await login("CODE-ONE")).status).toBe("revoked_code");
    const s3 = await login("CODE-TWO");
    expect(s3.status).toBe("ok");

    // Deactivating ends sessions and blocks login; reactivating restores login.
    await db.query("select public.set_customer_active($1, false)", [cid]);
    expect((await session(s3.token)).status).toBe("ended");
    expect((await login("CODE-TWO")).status).toBe("inactive_account");
    await db.query("select public.set_customer_active($1, true)", [cid]);
    expect((await login("CODE-TWO")).status).toBe("ok");

    const reasons = (await db.query<{ end_reason: string }>("select end_reason from public.customer_sessions where customer_id = $1 order by created_at", [cid])).rows.map((r) => r.end_reason);
    expect(reasons.slice(0, 3)).toEqual(["logout", "code_regenerated", "deactivated"]);

    // Soft delete: login fails like an unknown code, history is kept.
    await db.query("select public.delete_customer($1)", [cid]);
    expect((await login("CODE-TWO")).status).toBe("invalid_code");
    const kept = (await db.query<{ n: number }>("select count(*)::int as n from public.login_events where customer_id = $1", [cid])).rows[0].n;
    expect(kept).toBeGreaterThan(5);
    // The name can be reused after deletion.
    await db.query("select public.create_customer('Corner Deli', $1, 'EF56')", [sha("CODE-THREE")]);
  });

  it("expires idle sessions without claiming a logout", async () => {
    await db.query("select public.create_customer('Idle Shop', $1, 'ZZ99')", [sha("IDLE-CODE")]);
    const s = await login("IDLE-CODE", "198.51.100.9");
    await db.query("update public.customer_sessions set last_seen_at = now() - interval '8 days' where id = $1", [s.session_id]);
    expect((await session(s.token)).status).toBe("expired");
    const row = (await db.query<{ end_reason: string; ended_at: string; last_seen_at: string }>(
      "select end_reason, ended_at, last_seen_at from public.customer_sessions where id = $1", [s.session_id])).rows[0];
    expect(row.end_reason).toBe("expired");
    expect(new Date(row.ended_at).getTime()).toBeLessThan(Date.now() - 23 * 3600 * 1000);
  });

  it("records failures without the code and rate limits per IP", async () => {
    for (let i = 0; i < 10; i++) expect((await login(`WRONG-${i}`, "192.0.2.77")).status).toBe("invalid_code");
    expect((await login("WRONG-X", "192.0.2.77")).status).toBe("rate_limited");
    // Another IP is unaffected.
    expect((await login("WRONG-Y", "192.0.2.78")).status).toBe("invalid_code");
    const cols = (await db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'login_events'")).rows.map((r) => r.column_name);
    expect(cols.some((c) => /code/.test(c))).toBe(false);
    const rl = (await db.query<{ n: number }>("select count(*)::int as n from public.login_events where ip = '192.0.2.77' and rate_limited")).rows[0].n;
    expect(rl).toBe(1);
  });
});

describe("out of stock (stock migration)", () => {
  it("refuses out-of-stock products and flavors in quotes and orders, and restocking restores them", async () => {
    const plain = await addProduct("Ice 10lb", 300);
    const vape = await addProduct("Disposable 2g", 2000);
    const f = await db.query<{ id: string; name: string }>(
      "insert into public.product_flavors (product_id, name, sort_order) values ($1, 'Mango', 1), ($1, 'Kiwi', 2) returning id, name", [vape],
    );
    const mango = f.rows.find((r) => r.name === "Mango")!.id;
    const kiwi = f.rows.find((r) => r.name === "Kiwi")!.id;

    // New products and flavors start in stock.
    const ok = await quote([{ product_id: plain, quantity: 1 }, { product_id: vape, flavor_id: kiwi, quantity: 1 }]);
    expect(ok.unavailable).toEqual([]);

    await db.query("update public.products set in_stock = false where id = $1", [plain]);
    await db.query("update public.product_flavors set in_stock = false where id = $1", [kiwi]);
    const q = await quote([
      { product_id: plain, quantity: 1 },
      { product_id: vape, flavor_id: kiwi, quantity: 1 },
      { product_id: vape, flavor_id: mango, quantity: 2 },
    ]);
    expect(q.unavailable).toEqual([
      { product_id: plain, flavor_id: null, reason: "out_of_stock" },
      { product_id: vape, flavor_id: kiwi, reason: "flavor_out_of_stock" },
    ]);
    expect(q.lines).toHaveLength(1); // Mango is still orderable
    await expect(place("Stock Test", [{ product_id: vape, flavor_id: kiwi, quantity: 1 }], 2000)).rejects.toThrow();

    // The whole product out of stock blocks every flavor.
    await db.query("update public.products set in_stock = false where id = $1", [vape]);
    expect((await quote([{ product_id: vape, flavor_id: mango, quantity: 1 }])).unavailable[0].reason).toBe("out_of_stock");

    await db.query("update public.products set in_stock = true where id in ($1, $2)", [plain, vape]);
    await db.query("update public.product_flavors set in_stock = true where id = $1", [kiwi]);
    const o = await place("Stock Test", [{ product_id: vape, flavor_id: kiwi, quantity: 1 }, { product_id: plain, quantity: 1 }], 2300);
    expect(o.created).toBe(true);
  });
});
