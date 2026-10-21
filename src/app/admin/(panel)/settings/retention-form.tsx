"use client";

import { useActionState } from "react";
import { btn } from "@/components/ui";
import { purgeExpiredOrders } from "./actions";

export function RetentionForm({ years }: { years: number }) {
  const [state, action, pending] = useActionState(purgeExpiredOrders, null);
  return (
    <form
      action={action}
      className="mt-4 flex flex-wrap items-center gap-3"
      onSubmit={(e) => {
        if (!confirm(`Permanently delete completed and cancelled orders older than ${years} years, including their invoices? Check your accounting obligations first.`)) e.preventDefault();
      }}
    >
      <button disabled={pending} className={btn.secondary}>{pending ? "Removing…" : "Remove expired records"}</button>
      {state?.ok && <p className="text-sm text-muted">{state.ok}</p>}
      {state?.error && <p className="text-sm text-danger">{state.error}</p>}
    </form>
  );
}
