/** Shared class names keep buttons and inputs consistent everywhere. */
export const btn = {
  primary:
    "inline-flex items-center justify-center gap-2 rounded-lg bg-ink px-4 h-11 text-sm font-medium text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-40",
  secondary:
    "inline-flex items-center justify-center gap-2 rounded-lg border border-line bg-card px-4 h-11 text-sm font-medium text-ink transition-colors hover:border-ink/40 disabled:cursor-not-allowed disabled:opacity-40",
  accent:
    "inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 h-11 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40",
  ghost:
    "inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 h-9 text-sm text-muted transition-colors hover:bg-subtle hover:text-ink disabled:opacity-40",
  danger:
    "inline-flex items-center justify-center gap-2 rounded-lg border border-line bg-card px-4 h-11 text-sm font-medium text-danger transition-colors hover:border-danger/50",
  small:
    "inline-flex items-center justify-center rounded-md border border-line bg-card px-3 h-8 text-xs font-medium text-ink transition-colors hover:border-ink/40 disabled:opacity-40",
};

export const input =
  "block w-full rounded-lg border border-line bg-card px-3 h-11 text-[15px] text-ink placeholder:text-muted/70 transition-colors focus:border-ink focus:outline-none";

export const textarea =
  "block w-full rounded-lg border border-line bg-card px-3 py-2.5 text-[15px] text-ink placeholder:text-muted/70 transition-colors focus:border-ink focus:outline-none";

export const label = "mb-1.5 block text-sm font-medium text-ink";
export const hint = "mt-1.5 text-xs text-muted";
