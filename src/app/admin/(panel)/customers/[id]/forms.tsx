"use client";

import { useActionForm } from "@/components/use-action-form";
import { CodeReveal } from "@/components/admin/code-reveal";
import { btn, input, label } from "@/components/ui";
import { regenerateCode, renameCustomer } from "../actions";

export function RenameForm({ id, name }: { id: string; name: string }) {
  const { state, pending, onSubmit } = useActionForm(renameCustomer, null);
  return (
    <form onSubmit={onSubmit} className="mt-3">
      <input type="hidden" name="id" value={id} />
      <label htmlFor="rename" className={label}>Business or account name</label>
      <div className="flex gap-2">
        <input id="rename" name="name" defaultValue={name} required maxLength={120} className={input} />
        <button disabled={pending} className={`${btn.secondary} shrink-0`}>{pending ? "Saving…" : "Save"}</button>
      </div>
      {state?.ok && <p className="mt-2 text-sm text-accent">{state.ok}</p>}
      {state?.error && <p role="alert" className="mt-2 text-sm text-danger">{state.error}</p>}
    </form>
  );
}

export function RegenerateForm({ id, name }: { id: string; name: string }) {
  const { state, pending, onSubmit } = useActionForm(regenerateCode, null);
  return (
    <div className="mt-4">
      {state?.code && (
        <div className="mb-4">
          <CodeReveal code={state.code} note="The previous code no longer works and any open sessions were signed out. Copy this one now — it won't be shown again." />
        </div>
      )}
      <form
        onSubmit={(e) => {
          if (!confirm(`Generate a new code for ${name}? Their current code will stop working immediately and they'll be signed out.`)) {
            e.preventDefault();
            return;
          }
          onSubmit(e);
        }}
      >
        <input type="hidden" name="id" value={id} />
        <button disabled={pending} className={btn.secondary}>{pending ? "Generating…" : state?.code ? "Generate another code" : "Regenerate code"}</button>
      </form>
      {state?.error && <p role="alert" className="mt-2 text-sm text-danger">{state.error}</p>}
    </div>
  );
}
