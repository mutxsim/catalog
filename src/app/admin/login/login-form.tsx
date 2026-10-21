"use client";

import { btn, input, label } from "@/components/ui";
import { useActionForm } from "@/components/use-action-form";
import { signIn } from "./actions";

export function LoginForm() {
  const { state, pending, onSubmit } = useActionForm(signIn, null);
  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-4">
      <div>
        <label htmlFor="email" className={label}>Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required className={input} />
      </div>
      <div>
        <label htmlFor="password" className={label}>Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className={input} />
      </div>
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      <button type="submit" disabled={pending} className={`${btn.primary} w-full`}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
