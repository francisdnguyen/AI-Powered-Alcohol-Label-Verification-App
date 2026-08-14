"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  loadDispositions,
  DISPOSITION_LABEL,
  type Disposition,
} from "@/lib/dispositions";
import type { ApplicationSummary } from "@/lib/applications";

type StatusFilter = "all" | Disposition;

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "needs-info", label: "Needs info" },
];

export default function QueuePage() {
  const router = useRouter();
  const [rows, setRows] = useState<ApplicationSummary[]>([]);
  const [dispositions, setDispositions] = useState<Record<string, Disposition>>({});
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    fetch("/api/applications")
      .then((r) => r.json())
      .then((d: { applications?: ApplicationSummary[] }) => setRows(d.applications ?? []))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const refresh = () => setDispositions(loadDispositions());
    refresh();
    window.addEventListener("ttb-dispositions-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("ttb-dispositions-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const statusOf = (id: string): Disposition => dispositions[id] ?? "pending";

  const counts = useMemo(() => {
    const c = { all: rows.length, pending: 0, approved: 0, rejected: 0, "needs-info": 0 } as Record<
      StatusFilter,
      number
    >;
    for (const r of rows) c[statusOf(r.id)]++;
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, dispositions]);

  const highPriorityPending = useMemo(
    () => rows.filter((r) => r.priority === "high" && statusOf(r.id) === "pending").length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, dispositions],
  );
  const actioned = rows.length - counts.pending;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (filter !== "all" && statusOf(r.id) !== filter) return false;
      if (!q) return true;
      return (
        r.brandName.toLowerCase().includes(q) ||
        r.productName.toLowerCase().includes(q) ||
        r.ttbId.toLowerCase().includes(q)
      );
    });
    // Triage: float still-pending high-priority items to the top; otherwise keep queue order.
    const rank = (r: ApplicationSummary) =>
      r.priority === "high" && statusOf(r.id) === "pending" ? 0 : 1;
    return filtered
      .map((r, i) => ({ r, i }))
      .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
      .map((x) => x.r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, dispositions, filter, query]);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-10">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
          Label approvals
        </h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-300">
          Pending alcohol label applications awaiting compliance review. Open one to verify its label
          against the submitted filing.
        </p>
      </header>

      <section aria-label="Queue summary" className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Applications" value={rows.length} />
        <StatTile label="Pending review" value={counts.pending} />
        <StatTile label="High priority" value={highPriorityPending} tone="amber" />
        <StatTile label="Actioned" value={actioned} tone="green" />
      </section>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              aria-pressed={filter === t.key}
              onClick={() => setFilter(t.key)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                filter === t.key
                  ? "bg-blue-700 text-white"
                  : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
              }`}
            >
              {t.label} <span className="tabular-nums opacity-70">{counts[t.key]}</span>
            </button>
          ))}
        </div>
        <label className="relative">
          <span className="sr-only">Search applications</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search brand, product, or COLA ID"
            className="w-64 max-w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
        </label>
      </div>

      <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/10">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
            <tr>
              <th className="px-4 py-3 font-medium">Application</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">ABV</th>
              <th className="px-4 py-3 font-medium">Priority</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-neutral-500">
                  Loading queue…
                </td>
              </tr>
            )}
            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-neutral-500">
                  {rows.length === 0
                    ? loadError
                      ? "Couldn't load the queue — please refresh."
                      : "No applications in the queue."
                    : "No applications match this view."}
                </td>
              </tr>
            )}
            {visible.map((r) => (
              <tr
                key={r.id}
                onClick={() => router.push(`/review/${r.id}`)}
                className="cursor-pointer border-t border-black/5 hover:bg-blue-50/60 dark:border-white/5 dark:hover:bg-blue-950/30"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/review/${r.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="font-medium text-neutral-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-neutral-100"
                  >
                    {r.brandName}
                  </Link>
                  <div className="text-xs text-neutral-500 dark:text-neutral-400">
                    {r.ttbId} · {r.productName}
                  </div>
                </td>
                <td className="px-4 py-3 text-neutral-700 dark:text-neutral-300">{r.category}</td>
                <td className="px-4 py-3 tabular-nums text-neutral-700 dark:text-neutral-300">
                  {r.alcoholContent}
                </td>
                <td className="px-4 py-3">
                  {r.priority === "high" ? (
                    <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                      <span aria-hidden>●</span> High
                    </span>
                  ) : (
                    <span className="text-neutral-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={statusOf(r.id)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function StatTile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "amber" | "green";
}) {
  const toneCls =
    tone === "amber"
      ? "text-amber-700 dark:text-amber-400"
      : tone === "green"
        ? "text-green-700 dark:text-green-400"
        : "text-neutral-900 dark:text-neutral-100";
  return (
    <div className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-neutral-900">
      <div className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${toneCls}`}>{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: Disposition }) {
  const cls: Record<Disposition, string> = {
    pending: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200",
    approved: "bg-green-700 text-white",
    rejected: "bg-red-700 text-white",
    "needs-info": "bg-amber-500 text-black",
  };
  return (
    <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${cls[status]}`}>
      {DISPOSITION_LABEL[status]}
    </span>
  );
}
