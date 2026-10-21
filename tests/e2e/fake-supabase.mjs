/**
 * A small local stand-in for Supabase (PostgREST subset, Storage, Auth) and the
 * WhatsApp Graph API, backed by in-process Postgres (PGlite) running the real
 * migration. Used only by the end-to-end test — never in production.
 *
 *   node tests/e2e/fake-supabase.mjs   (listens on FAKE_PORT, default 54321)
 */
import http from "node:http";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.FAKE_PORT ?? 54321);
const JWT_SECRET = "fake-secret";
const ADMIN = { id: "00000000-0000-4000-8000-000000000001", email: "admin@example.com", password: "admin-pass-123" };

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema storage;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.role', true), '') $$;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
`);
await db.exec(readFileSync(join(here, "..", "..", "supabase", "migrations", "0001_init.sql"), "utf8"));
await db.query("insert into auth.users (id, email) values ($1, $2)", [ADMIN.id, ADMIN.email]);
await db.query("insert into public.admins (user_id) values ($1)", [ADMIN.id]);

const files = new Map(); // "bucket/path" -> { bytes, type }
export const whatsappLog = [];

// ---------------------------------------------------------------- helpers
const IDENT = /^[a-z_][a-z0-9_]*$/;
const ident = (s) => {
  if (!IDENT.test(s)) throw Object.assign(new Error(`bad identifier ${s}`), { status: 400 });
  return `"${s}"`;
};
const send = (res, status, body, headers = {}) => {
  const isBuf = body instanceof Uint8Array;
  res.writeHead(status, { "Content-Type": isBuf ? headers["Content-Type"] ?? "application/octet-stream" : "application/json", ...headers });
  res.end(isBuf ? Buffer.from(body) : body === undefined ? "" : JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function jwt(payload) {
  const head = b64url({ alg: "HS256", typ: "JWT" });
  const body = b64url(payload);
  return `${head}.${body}.${createHmac("sha256", JWT_SECRET).update(`${head}.${body}`).digest("base64url")}`;
}
function verify(token) {
  const [h, b, s] = (token ?? "").split(".");
  if (!s || createHmac("sha256", JWT_SECRET).update(`${h}.${b}`).digest("base64url") !== s) return null;
  const p = JSON.parse(Buffer.from(b, "base64url").toString());
  return p.exp * 1000 > Date.now() ? p : null;
}
const user = () => ({ id: ADMIN.id, aud: "authenticated", role: "authenticated", email: ADMIN.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() });

// ---------------------------------------------------------------- PostgREST subset
function splitTop(s) {
  const out = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function condition(col, expr, params) {
  let negate = false;
  if (expr.startsWith("not.")) { negate = true; expr = expr.slice(4); }
  const dot = expr.indexOf(".");
  const op = expr.slice(0, dot);
  const val = expr.slice(dot + 1);
  const c = ident(col);
  let sql;
  switch (op) {
    case "eq": params.push(val); sql = `${c}::text = $${params.length}`; break;
    case "neq": params.push(val); sql = `${c}::text <> $${params.length}`; break;
    case "ilike": params.push(val.replace(/\*/g, "%")); sql = `${c}::text ilike $${params.length}`; break;
    case "like": params.push(val.replace(/\*/g, "%")); sql = `${c}::text like $${params.length}`; break;
    case "is": sql = `${c} is ${val === "null" ? "null" : val === "true" ? "true" : "false"}`; break;
    case "in": {
      const items = splitTop(val.replace(/^\(|\)$/g, "")).map((v) => v.replace(/^"|"$/g, ""));
      params.push(items);
      sql = `${c}::text = any($${params.length}::text[])`;
      break;
    }
    default: throw Object.assign(new Error(`unsupported operator ${op}`), { status: 400 });
  }
  return negate ? `not (${sql})` : sql;
}

function whereClause(search, params) {
  const parts = [];
  for (const [k, v] of search) {
    if (["select", "order", "limit", "offset", "columns", "on_conflict"].includes(k)) continue;
    if (k === "or") {
      const ors = splitTop(v.replace(/^\(|\)$/g, "")).map((p) => {
        const i = p.indexOf(".");
        return condition(p.slice(0, i), p.slice(i + 1), params);
      });
      parts.push(`(${ors.join(" or ")})`);
    } else parts.push(condition(k, v, params));
  }
  return parts.length ? `where ${parts.join(" and ")}` : "";
}

function selectList(select) {
  if (!select || select === "*") return "*";
  return select.split(",").map((c) => ident(c.trim())).join(", ");
}

async function rest(req, res, url, body) {
  const path = url.pathname.replace(/^\/rest\/v1\//, "");
  const params = [];

  if (path.startsWith("rpc/")) {
    const fn = path.slice(4);
    ident(fn);
    const args = body.length ? JSON.parse(body.toString()) : {};
    const named = Object.entries(args).map(([k, v]) => {
      params.push(v === null ? null : typeof v === "object" ? JSON.stringify(v) : String(v));
      return `${ident(k)} => $${params.length}`;
    });
    const { rows: meta } = await db.query("select proretset from pg_proc where proname = $1 limit 1", [fn]);
    const call = `public.${ident(fn)}(${named.join(", ")})`;
    const sql = meta[0]?.proretset ? `select coalesce(json_agg(r), '[]'::json) as v from ${call} r` : `select to_json(${call}) as v`;
    const { rows } = await db.query(sql, params);
    return send(res, 200, rows[0].v);
  }

  const table = ident(path);
  const where = whereClause(url.searchParams, params);
  const wantObject = (req.headers.accept ?? "").includes("vnd.pgrst.object");
  const prefer = req.headers.prefer ?? "";
  const wantRows = prefer.includes("return=representation");

  if (req.method === "GET" || req.method === "HEAD") {
    const order = url.searchParams.get("order");
    const orderSql = order
      ? `order by ${order.split(",").map((o) => { const [c, dir] = o.split("."); return `${ident(c)} ${dir === "desc" ? "desc" : "asc"}`; }).join(", ")}`
      : "";
    const limit = url.searchParams.get("limit");
    const offset = url.searchParams.get("offset");
    const page = `${limit ? `limit ${Number(limit)}` : ""} ${offset ? `offset ${Number(offset)}` : ""}`;
    const { rows } = await db.query(
      `select coalesce(json_agg(t), '[]'::json) as v from (select ${selectList(url.searchParams.get("select"))} from public.${table} ${where} ${orderSql} ${page}) t`,
      params,
    );
    const data = rows[0].v;
    const headers = {};
    if (prefer.includes("count=exact")) {
      const { rows: c } = await db.query(`select count(*)::int as n from public.${table} ${where}`, params);
      headers["Content-Range"] = `${offset ?? 0}-${Number(offset ?? 0) + data.length - 1}/${c[0].n}`;
    }
    if (wantObject) {
      if (data.length !== 1) return send(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `${data.length} rows`, hint: null });
      return send(res, 200, data[0], headers);
    }
    return send(res, 200, data, headers);
  }

  const payload = body.length ? JSON.parse(body.toString()) : {};
  const returning = `returning ${selectList(url.searchParams.get("select"))}`;
  let out = [];

  if (req.method === "POST") {
    for (const rec of Array.isArray(payload) ? payload : [payload]) {
      const cols = Object.keys(rec).map(ident);
      const p = [JSON.stringify(rec)];
      const { rows } = await db.query(
        `with ins as (insert into public.${table} (${cols.join(", ")}) select ${cols.join(", ")} from json_populate_record(null::public.${table}, $1::json) ${returning}) select coalesce(json_agg(ins), '[]'::json) as v from ins`,
        p,
      );
      out.push(...rows[0].v);
    }
  } else if (req.method === "PATCH") {
    const cols = Object.keys(payload).map(ident);
    params.push(JSON.stringify(payload));
    const n = params.length;
    const { rows } = await db.query(
      `with up as (update public.${table} set (${cols.join(", ")}) = (select ${cols.join(", ")} from json_populate_record(null::public.${table}, $${n}::json)) ${where} ${returning}) select coalesce(json_agg(up), '[]'::json) as v from up`,
      params,
    );
    out = rows[0].v;
  } else if (req.method === "DELETE") {
    const { rows } = await db.query(`with d as (delete from public.${table} ${where} ${returning}) select coalesce(json_agg(d), '[]'::json) as v from d`, params);
    out = rows[0].v;
  }

  if (wantObject) return out.length === 1 ? send(res, 200, out[0]) : send(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
  return wantRows ? send(res, req.method === "POST" ? 201 : 200, out) : send(res, 204);
}

// ---------------------------------------------------------------- Storage
async function storage(req, res, url, body) {
  const p = decodeURIComponent(url.pathname.replace(/^\/storage\/v1\//, ""));
  const pub = p.match(/^object\/public\/(.+)$/);
  if (req.method === "GET") {
    const key = pub ? pub[1] : p.replace(/^object\/(authenticated\/)?/, "");
    const f = files.get(key);
    return f ? send(res, 200, f.bytes, { "Content-Type": f.type }) : send(res, 404, { statusCode: "404", error: "not_found", message: "Object not found" });
  }
  if (req.method === "POST" && p.startsWith("object/")) {
    const key = p.slice("object/".length);
    if (files.has(key) && req.headers["x-upsert"] !== "true") return send(res, 400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
    let bytes = new Uint8Array(body);
    let type = req.headers["content-type"] ?? "application/octet-stream";
    if (type.startsWith("multipart/form-data")) {
      const form = await new Request("http://x", { method: "POST", headers: { "content-type": type }, body }).formData();
      const file = [...form.values()].find((v) => typeof v !== "string");
      bytes = new Uint8Array(await file.arrayBuffer());
      type = file.type || "application/octet-stream";
    }
    files.set(key, { bytes, type });
    return send(res, 200, { Key: key, Id: randomUUID() });
  }
  if (req.method === "DELETE" && p.startsWith("object/")) {
    const bucket = p.slice("object/".length);
    const { prefixes = [] } = JSON.parse(body.toString() || "{}");
    prefixes.forEach((x) => files.delete(`${bucket}/${x}`));
    return send(res, 200, prefixes.map((name) => ({ name })));
  }
  return send(res, 404, { message: "unsupported" });
}

// ---------------------------------------------------------------- Auth
async function auth(req, res, url, body) {
  const p = url.pathname.replace(/^\/auth\/v1\//, "");
  if (p === "token") {
    const b = JSON.parse(body.toString() || "{}");
    const ok =
      (url.searchParams.get("grant_type") === "password" && b.email === ADMIN.email && b.password === ADMIN.password) ||
      (url.searchParams.get("grant_type") === "refresh_token" && b.refresh_token === "fake-refresh");
    if (!ok) return send(res, 400, { error: "invalid_grant", error_description: "Invalid login credentials", code: "invalid_credentials", msg: "Invalid login credentials" });
    const exp = Math.floor(Date.now() / 1000) + 3600;
    return send(res, 200, {
      access_token: jwt({ sub: ADMIN.id, role: "authenticated", aud: "authenticated", email: ADMIN.email, exp, iat: exp - 3600, session_id: randomUUID() }),
      token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "fake-refresh", user: user(),
    });
  }
  if (p === "user") {
    const claims = verify((req.headers.authorization ?? "").replace(/^Bearer /, ""));
    return claims ? send(res, 200, user()) : send(res, 401, { code: 401, msg: "invalid JWT", error_code: "bad_jwt" });
  }
  if (p === "logout") return send(res, 204);
  if (p.includes("jwks")) return send(res, 200, { keys: [] });
  return send(res, 404, { msg: "unsupported" });
}

// ---------------------------------------------------------------- WhatsApp Graph API
async function graph(req, res, url, body) {
  if (url.pathname.endsWith("/media")) {
    const form = await new Request("http://x", { method: "POST", headers: { "content-type": req.headers["content-type"] }, body }).formData();
    const file = form.get("file");
    const id = `media-${whatsappLog.length + 1}`;
    whatsappLog.push({ kind: "media", id, type: form.get("type"), size: file.size, name: file.name, auth: req.headers.authorization?.startsWith("Bearer ") });
    files.set(`whatsapp/${id}.pdf`, { bytes: new Uint8Array(await file.arrayBuffer()), type: "application/pdf" });
    return send(res, 200, { id });
  }
  if (url.pathname.endsWith("/messages")) {
    const payload = JSON.parse(body.toString());
    if (process.env.FAKE_WHATSAPP_FAIL === "1") return send(res, 400, { error: { message: "Recipient not in allowed list", code: 131030 } });
    const id = `wamid.${whatsappLog.length + 1}`;
    whatsappLog.push({ kind: "message", id, payload });
    return send(res, 200, { messaging_product: "whatsapp", contacts: [{ wa_id: payload.to }], messages: [{ id }] });
  }
  return send(res, 404, {});
}

// ---------------------------------------------------------------- server
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const body = await readBody(req);
  if (process.env.FAKE_LOG) console.log(req.method, decodeURIComponent(req.url));
  try {
    if (url.pathname.startsWith("/rest/v1/")) return await rest(req, res, url, body);
    if (url.pathname.startsWith("/storage/v1/")) return await storage(req, res, url, body);
    if (url.pathname.startsWith("/auth/v1/")) return await auth(req, res, url, body);
    if (url.pathname.startsWith("/graph/")) return await graph(req, res, url, body);
    if (url.pathname === "/__test/whatsapp") return send(res, 200, whatsappLog);
    if (url.pathname === "/__test/file") {
      const f = files.get(url.searchParams.get("key"));
      return f ? send(res, 200, f.bytes, { "Content-Type": f.type }) : send(res, 404, {});
    }
    if (url.pathname === "/__test/sql" && req.method === "POST") {
      const { sql, params } = JSON.parse(body.toString());
      const r = await db.query(sql, params ?? []);
      return send(res, 200, r.rows);
    }
    if (url.pathname === "/__test/upload" && req.method === "POST") {
      files.set(url.searchParams.get("key"), { bytes: new Uint8Array(body), type: req.headers["content-type"] });
      return send(res, 200, {});
    }
    send(res, 404, { message: "not found" });
  } catch (e) {
    send(res, e.status ?? 400, { code: "P0001", message: e.message, details: null, hint: null });
  }
});
server.listen(PORT, "127.0.0.1", () => console.log(`fake supabase on http://127.0.0.1:${PORT}`));
