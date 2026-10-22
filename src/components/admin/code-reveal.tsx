"use client";

import { useState } from "react";
import { btn } from "@/components/ui";

/** Shows a freshly generated access code once, with a one-click copy. */
export function CodeReveal({ code, note }: { code: string; note?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Clipboard blocked (e.g. insecure context): select the text instead.
      const el = document.getElementById(`code-${code}`);
      if (el) window.getSelection()?.selectAllChildren(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="rounded-xl border border-accent/30 bg-accent-soft p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-accent">Access code</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <code id={`code-${code}`} data-testid="access-code" className="select-all font-mono text-xl font-semibold tracking-[0.12em]">
          {code}
        </code>
        <button type="button" onClick={copy} className={btn.small}>
          {copied ? "Copied ✓" : "Copy Code"}
        </button>
      </div>
      <p className="mt-2 text-xs text-muted">
        {note ?? "Copy it now and send it to the customer. For security it's stored only in scrambled form and can't be shown again — regenerate it if lost."}
      </p>
    </div>
  );
}
