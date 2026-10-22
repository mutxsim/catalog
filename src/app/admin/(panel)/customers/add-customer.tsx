"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useActionForm } from "@/components/use-action-form";
import { CodeReveal } from "@/components/admin/code-reveal";
import { btn, input, label } from "@/components/ui";
import { createCustomer } from "./actions";

export function AddCustomer() {
  const [open, setOpen] = useState(false);
  const { state, pending, onSubmit } = useActionForm(createCustomer, null);
  const formRef = useRef<HTMLFormElement>(null);

  if (!open && !state?.code) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${btn.primary} mt-5`}>
        Add Customer
      </button>
    );
  }

  return (
    <section className="mt-5 max-w-xl rounded-xl border border-line bg-card p-4">
      {state?.code ? (
        <div>
          <p className="text-sm">
            <span className="font-medium">{state.name}</span> was created and is active.
          </p>
          <div className="mt-3">
            <CodeReveal code={state.code} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href={`/admin/customers/${state.customerId}`} className={btn.secondary}>Open account</Link>
            <button
              type="button"
              className={btn.ghost}
              onClick={() => {
                setOpen(true);
                window.location.reload();
              }}
            >
              Add another
            </button>
          </div>
        </div>
      ) : (
        <form ref={formRef} onSubmit={onSubmit}>
          <label htmlFor="customer-name" className={label}>Customer or business name</label>
          <input id="customer-name" name="name" required maxLength={120} autoFocus className={input} placeholder="e.g. Main Street Market — Kensington" />
          <p className="mt-1.5 text-xs text-muted">For your records only — customers log in with just their access code.</p>
          {state?.error && <p role="alert" className="mt-2 text-sm text-danger">{state.error}</p>}
          <div className="mt-4 flex gap-2">
            <button disabled={pending} className={btn.primary}>{pending ? "Creating…" : "Create & generate code"}</button>
            <button type="button" onClick={() => setOpen(false)} className={btn.ghost}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}
