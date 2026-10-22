"use client";

import { useActionForm } from "@/components/use-action-form";
import { customerLogin } from "./actions";

export function LoginForm() {
  const { state, pending, onSubmit } = useActionForm(customerLogin, null);
  return (
    <form onSubmit={onSubmit} noValidate>
      <label htmlFor="code" className="mb-2 block text-sm font-medium">Access Code</label>
      <input
        id="code"
        name="code"
        required
        autoFocus
        autoComplete="one-time-code"
        autoCapitalize="characters"
        spellCheck={false}
        placeholder="XXXX-XXXX-XXXX-XXXX"
        aria-invalid={state?.error ? true : undefined}
        aria-describedby={state?.error ? "code-error" : undefined}
        className="block h-14 w-full rounded-2xl border border-line bg-paper px-4 text-center font-mono text-lg tracking-[0.15em] text-ink uppercase placeholder:text-muted/50 placeholder:tracking-[0.15em] focus:border-accent focus:outline-none"
      />
      {state?.error && (
        <p id="code-error" role="alert" className="mt-3 text-sm text-danger">{state.error}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-cta text-[15px] font-semibold text-on-cta transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pending && <span className="h-4 w-4 animate-spin rounded-full border-2 border-on-cta/40 border-t-on-cta" aria-hidden />}
        {pending ? "Checking…" : "Login"}
      </button>
    </form>
  );
}
