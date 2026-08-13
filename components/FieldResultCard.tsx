import type { FieldResult } from "@/lib/matcher";
import { STATUS_META, StatusBadge } from "./StatusBadge";

const CONFIDENCE_LABEL: Record<string, string> = {
  high: "Clear read",
  medium: "Partly legible",
  low: "Hard to read",
};

export function FieldResultCard({ field }: { field: FieldResult }) {
  const accent = STATUS_META[field.status].accent;
  const showExpected = field.expected !== null;

  return (
    <li
      className={`list-none rounded-lg border border-black/10 border-l-4 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-neutral-900 ${accent}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
          {field.label}
        </h3>
        <StatusBadge status={field.status} />
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-medium text-neutral-500 dark:text-neutral-400">
            On the label
          </dt>
          <dd className="mt-0.5 break-words text-neutral-900 dark:text-neutral-100">
            {field.extracted ?? (
              <span className="italic text-neutral-400">not found</span>
            )}
          </dd>
        </div>
        {showExpected && (
          <div>
            <dt className="font-medium text-neutral-500 dark:text-neutral-400">
              Expected
            </dt>
            <dd className="mt-0.5 break-words text-neutral-900 dark:text-neutral-100">
              {field.expected}
            </dd>
          </div>
        )}
      </dl>

      <p className="mt-3 text-sm text-neutral-700 dark:text-neutral-300">
        {field.note}
      </p>

      <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
        Read quality: {CONFIDENCE_LABEL[field.confidence] ?? field.confidence}
      </p>
    </li>
  );
}
