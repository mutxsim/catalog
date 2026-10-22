"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { codeHint, generateAccessCode, hashAccessCode } from "@/lib/access-code";
import { customerNameSchema, firstError } from "@/lib/validation";
import { UUID_RE } from "@/lib/orders";

export type CodeState = { error?: string; code?: string; customerId?: string; name?: string; ok?: string } | null;

const nameTaken = (msg: string) => /customers_name_key|duplicate/.test(msg);

function refresh(id?: string) {
  revalidatePath("/admin/customers");
  if (id) revalidatePath(`/admin/customers/${id}`);
  revalidatePath("/admin/activity");
}

/** Creates the account and returns the new code once, for the admin to copy. */
export async function createCustomer(_prev: CodeState, formData: FormData): Promise<CodeState> {
  await requireAdmin();
  const parsed = customerNameSchema.safeParse(String(formData.get("name") ?? ""));
  if (!parsed.success) return { error: firstError(parsed.error) };
  const code = generateAccessCode();
  const { data, error } = await createServiceClient().rpc("create_customer", {
    p_name: parsed.data,
    p_code_hash: hashAccessCode(code),
    p_code_hint: codeHint(code),
  });
  if (error) {
    return { error: nameTaken(error.message) ? `A customer named “${parsed.data}” already exists. Use a distinct name (e.g. add the location).` : "Couldn't create the customer." };
  }
  refresh();
  return { code, customerId: data as string, name: parsed.data };
}

export async function renameCustomer(_prev: CodeState, formData: FormData): Promise<CodeState> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const parsed = customerNameSchema.safeParse(String(formData.get("name") ?? ""));
  if (!UUID_RE.test(id)) return { error: "Unknown customer." };
  if (!parsed.success) return { error: firstError(parsed.error) };
  const { error } = await createServiceClient().from("customers").update({ name: parsed.data }).eq("id", id).is("deleted_at", null);
  if (error) return { error: nameTaken(error.message) ? `Another customer is already named “${parsed.data}”.` : "Couldn't rename the customer." };
  refresh(id);
  return { ok: "Name saved." };
}

/** New code; the old one stops working and live sessions end immediately. */
export async function regenerateCode(_prev: CodeState, formData: FormData): Promise<CodeState> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!UUID_RE.test(id)) return { error: "Unknown customer." };
  const code = generateAccessCode();
  const { error } = await createServiceClient().rpc("regenerate_customer_code", {
    p_customer_id: id,
    p_code_hash: hashAccessCode(code),
    p_code_hint: codeHint(code),
  });
  if (error) return { error: "Couldn't regenerate the code." };
  refresh(id);
  return { code, customerId: id };
}

export async function setCustomerActive(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!UUID_RE.test(id)) return;
  await createServiceClient().rpc("set_customer_active", { p_customer_id: id, p_active: formData.get("active") === "true" });
  refresh(id);
}

export async function deleteCustomer(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!UUID_RE.test(id)) return;
  await createServiceClient().rpc("delete_customer", { p_customer_id: id });
  refresh(id);
  redirect("/admin/customers?deleted=1");
}
