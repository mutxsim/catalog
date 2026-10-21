"use client";

import { useActionState } from "react";
import { btn } from "@/components/ui";
import { resendWhatsApp } from "../actions";

export function ResendButton({ id, label, again }: { id: string; label: string; again?: boolean }) {
  const [state, action, pending] = useActionState(resendWhatsApp, null);
  return (
    <form
      action={action}
      className="mt-4"
      onSubmit={(e) => {
        if (again && !confirm("This order was already sent. Send it again?")) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      {again && <input type="hidden" name="force" value="1" />}
      <button disabled={pending} className={btn.secondary}>{pending ? "Sending…" : label}</button>
      {state && <p className={`mt-2 text-sm ${state.ok ? "text-accent" : "text-danger"}`}>{state.message}</p>}
    </form>
  );
}
