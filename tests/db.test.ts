/**
 * Runs supabase/migrations/0001_init.sql against an in-process Postgres
 * (PGlite) with minimal stand-ins for Supabase's auth/storage schemas, then
 * exercises pricing, ordering, idempotency and immutability rules.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
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
    unavailable: string[];
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
  await db.exec(readFileSync(join(__dirname, "..", "supabase", "migrations", "0001_init.sql"), "utf8"));
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
    expect(q.unavailable).toEqual([b]);
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
