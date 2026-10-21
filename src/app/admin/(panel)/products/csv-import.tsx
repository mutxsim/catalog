"use client";

import { useActionState } from "react";
import { btn } from "@/components/ui";
import { importProductsCsv } from "./actions";

export function CsvImport() {
  const [state, action, pending] = useActionState(importProductsCsv, null);
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input name="file" type="file" accept=".csv,text/csv" required className="max-w-56 text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-card file:px-3 file:py-1.5 file:text-sm" />
        <button disabled={pending} className={btn.secondary}>{pending ? "Importing…" : "Import CSV"}</button>
      </div>
      {state?.ok && <p className="text-sm text-accent">{state.ok}</p>}
      {state?.error && <p className="max-w-xl text-sm text-danger">{state.error}</p>}
    </form>
  );
}
