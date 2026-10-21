"use client";

import { startTransition, useActionState } from "react";

/**
 * Like useActionState, but submits via onSubmit so React does not reset the
 * form's fields afterwards — a validation error never wipes what was typed.
 */
export function useActionForm<S>(action: (prev: Awaited<S>, formData: FormData) => S | Promise<S>, initial: Awaited<S>) {
  const [state, dispatch, pending] = useActionState<S, FormData>(action, initial);
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(() => dispatch(formData));
  };
  return { state, pending, onSubmit };
}
