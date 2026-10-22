"use client";

import { useActionState } from "react";
import { btn } from "@/components/ui";
import { purgeLoginEvents } from "./actions";

export function PurgeLoginEvents() {
  const [state, action, pending] = useActionState(purgeLoginEvents, null);
  return (
    <details className="mt-10 rounded-xl border border-line bg-card">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Retention</summary>
      <div className="border-t border-line px-4 py-4 text-sm">
        <p className="text-muted">
          Login records are kept for the period set in Settings (default 365 days) and are never deleted automatically. Remove records older than that period here.
        </p>
        <form
          action={action}
          className="mt-3 flex flex-wrap items-center gap-3"
          onSubmit={(e) => {
            if (!confirm("Permanently delete login records older than the retention period?")) e.preventDefault();
          }}
        >
          <button disabled={pending} className={btn.secondary}>{pending ? "Removing…" : "Remove old login records"}</button>
          {state && <p className="text-sm text-muted">{state}</p>}
        </form>
      </div>
    </details>
  );
}
