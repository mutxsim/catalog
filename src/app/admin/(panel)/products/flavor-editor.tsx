"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { btn, hint, input } from "@/components/ui";

export type FlavorRow = { id: string | null; name: string; imageUrl: string | null };
type Row = FlavorRow & { key: string; removeImage: boolean; preview: string | null };

let counter = 0;
const newKey = () => `n${Date.now().toString(36)}${(counter++).toString(36)}`;

/**
 * Flavors are saved together with the product. Each row submits its name and
 * (optionally) a flavor-specific image; rows removed here are deleted on save.
 */
export function FlavorEditor({ initial }: { initial: FlavorRow[] }) {
  const [rows, setRows] = useState<Row[]>(() =>
    initial.map((f) => ({ ...f, key: f.id ?? newKey(), removeImage: false, preview: null })),
  );
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef<HTMLInputElement>(null);
  const previews = useRef(new Set<string>());

  useEffect(() => {
    const set = previews.current;
    return () => set.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const exists = (name: string, exceptKey?: string) =>
    rows.some((r) => r.key !== exceptKey && r.name.trim().toLowerCase() === name.trim().toLowerCase());

  const add = () => {
    const name = draft.trim();
    if (!name) return;
    if (name.length > 120) return setError("Flavor names must be 120 characters or fewer.");
    if (exists(name)) return setError(`“${name}” is already in the list.`);
    setRows((r) => [...r, { key: newKey(), id: null, name, imageUrl: null, removeImage: false, preview: null }]);
    setDraft("");
    setError(null);
    draftRef.current?.focus();
  };

  const update = (key: string, patch: Partial<Row>) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const move = (i: number, dir: -1 | 1) =>
    setRows((r) => {
      const j = i + dir;
      if (j < 0 || j >= r.length) return r;
      const next = [...r];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const payload = JSON.stringify(rows.map((r) => ({ key: r.key, id: r.id, name: r.name, removeImage: r.removeImage })));

  return (
    <fieldset className="rounded-lg border border-line bg-card px-3 pb-4 pt-3">
      <legend className="px-1 text-sm font-medium">
        Flavors <span className="font-normal text-muted">({rows.length}) · optional</span>
      </legend>
      <input type="hidden" name="flavors_json" value={payload} />

      <div className="flex gap-2">
        <input
          ref={draftRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          maxLength={120}
          placeholder="e.g. Blue Razz"
          aria-label="New flavor name"
          className={input}
        />
        <button type="button" onClick={add} disabled={!draft.trim()} className={`${btn.secondary} shrink-0`}>
          Add flavor
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}

      {rows.length > 0 && (
        <ul className="mt-3 max-h-[28rem] divide-y divide-line overflow-y-auto rounded-lg border border-line" aria-label="Flavors">
          {rows.map((r, i) => {
            const shown = r.preview ?? (r.removeImage ? null : r.imageUrl);
            const duplicate = r.name.trim() !== "" && exists(r.name, r.key);
            return (
              <li key={r.key} className="flex flex-wrap items-center gap-2 px-2 py-2 sm:flex-nowrap">
                <div className="flex flex-col">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${r.name} up`} className="h-5 w-6 text-xs text-muted hover:text-ink disabled:opacity-20">▲</button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label={`Move ${r.name} down`} className="h-5 w-6 text-xs text-muted hover:text-ink disabled:opacity-20">▼</button>
                </div>
                <label className="relative block h-10 w-10 shrink-0 cursor-pointer overflow-hidden rounded-md border border-line bg-subtle" title="Flavor image (optional)">
                  {shown ? (
                    r.preview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.preview} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Image src={shown} alt="" fill sizes="40px" className="object-cover" />
                    )
                  ) : (
                    <span className="flex h-full items-center justify-center text-lg text-muted">+</span>
                  )}
                  <input
                    type="file"
                    name={`flavor_image_${r.key}`}
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    aria-label={`Image for ${r.name}`}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      const url = f ? URL.createObjectURL(f) : null;
                      if (url) previews.current.add(url);
                      update(r.key, { preview: url, removeImage: false });
                    }}
                  />
                </label>
                <input
                  value={r.name}
                  onChange={(e) => update(r.key, { name: e.target.value })}
                  maxLength={120}
                  aria-label="Flavor name"
                  aria-invalid={duplicate || r.name.trim() === "" ? true : undefined}
                  className={`${input} h-10 min-w-0 flex-1 ${duplicate || r.name.trim() === "" ? "border-danger" : ""}`}
                />
                {(r.imageUrl || r.preview) && !r.removeImage && (
                  <button type="button" onClick={() => update(r.key, { removeImage: true, preview: null })} className={btn.ghost}>
                    No image
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                  className="h-9 rounded-md px-2.5 text-sm text-danger hover:bg-subtle"
                  aria-label={`Remove ${r.name}`}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className={hint}>
        Customers choose a flavor before adding this product to their cart. Price and SKU come from the product. Tap the square to give a flavor its own photo;
        otherwise the product photo is used. Changes apply when you save.
      </p>
    </fieldset>
  );
}
