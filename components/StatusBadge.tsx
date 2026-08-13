import type { FieldStatus } from "@/lib/matcher";

interface StatusMeta {
  label: string;
  symbol: string;
  /** Badge background + text; chosen for AA contrast in light and dark. */
  badge: string;
  /** Left accent stripe on the card. */
  accent: string;
}

// Status is never conveyed by color alone: each has a text label + a symbol.
export const STATUS_META: Record<FieldStatus, StatusMeta> = {
  match: {
    label: "Match",
    symbol: "✓",
    badge: "bg-green-700 text-white",
    accent: "border-l-green-600",
  },
  mismatch: {
    label: "Mismatch",
    symbol: "✕",
    badge: "bg-red-700 text-white",
    accent: "border-l-red-600",
  },
  missing: {
    label: "Missing",
    symbol: "!",
    badge: "bg-amber-500 text-black",
    accent: "border-l-amber-500",
  },
  review: {
    label: "Needs review",
    symbol: "?",
    badge: "bg-blue-700 text-white",
    accent: "border-l-blue-600",
  },
};

export function StatusBadge({ status }: { status: FieldStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${meta.badge}`}
    >
      <span aria-hidden="true">{meta.symbol}</span>
      {meta.label}
    </span>
  );
}
