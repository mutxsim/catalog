import { FAILURE_LABEL, type LoginEvent } from "@/lib/activity";

export function Result({ e }: { e: Pick<LoginEvent, "success" | "failure_reason"> }) {
  return e.success ? (
    <span className="whitespace-nowrap rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">Success</span>
  ) : (
    <span className="whitespace-nowrap rounded-full bg-subtle px-2 py-0.5 text-xs font-medium text-danger">
      Failed · {FAILURE_LABEL[e.failure_reason ?? ""] ?? "Unknown"}
    </span>
  );
}
