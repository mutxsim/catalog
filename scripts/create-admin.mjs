/**
 * Create (or promote) the administrator account.
 *
 *   npm run create-admin -- you@example.com 'a-strong-password'
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY from .env.local.
 */
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const [email, password] = process.argv.slice(2);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!email || !password) {
  console.error("Usage: npm run create-admin -- <email> <password>");
  process.exit(1);
}
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local first.");
  process.exit(1);
}
if (password.length < 12) {
  console.error("Use a password of at least 12 characters.");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

let userId;
const { data: created, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
if (created?.user) {
  userId = created.user.id;
  console.log(`Created user ${email}`);
} else if (/already|registered|exists/i.test(error?.message ?? "")) {
  const { data } = await db.auth.admin.listUsers({ perPage: 1000 });
  const existing = data?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!existing) throw new Error(`User exists but could not be found: ${error.message}`);
  userId = existing.id;
  await db.auth.admin.updateUserById(userId, { password });
  console.log(`User ${email} already existed — password updated`);
} else {
  console.error("Could not create user:", error?.message);
  process.exit(1);
}

const { error: adminError } = await db.from("admins").upsert({ user_id: userId });
if (adminError) {
  console.error("Could not grant admin access:", adminError.message);
  process.exit(1);
}
console.log(`${email} can now sign in at /admin`);
