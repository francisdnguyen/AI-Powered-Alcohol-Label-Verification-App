"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  IconLayers,
  IconClock,
  IconFlag,
  IconCheckCircle,
  IconSearch,
} from "@/components/icons";
import {
  loadDispositions,
  DISPOSITION_LABEL,
  type Disposition,
} from "@/lib/dispositions";
import {
  loadVerdicts,
  VERDICTS_CHANGED_EVENT,
  type StoredVerdict,
} from "@/lib/verdicts";
import { bulkVerify, summarize } from "@/lib/bulkVerify";
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
  const [verdicts, setVerdicts] = useState<Record<string, StoredVerdict>>({});
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [verifying, setVerifying] = useState(false);
  const [verifyTotal, setVerifyTotal] = useState(0);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/applications")
      .then((r) => r.json())
      .then((d: { applications?: ApplicationSummary[] }) => setRows(d.applications ?? []))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const refresh = () => {
      setDispositions(loadDispositions());
      setVerdicts(loadVerdicts());
    };
    refresh();
    window.addEventListener("ttb-dispositions-changed", refresh);
    window.addEventListener(VERDICTS_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("ttb-dispositions-changed", refresh);
      window.removeEventListener(VERDICTS_CHANGED_EVENT, refresh);
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

  // --- selection ---
  const visibleIds = visible.map((r) => r.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someVisibleSelected = visibleIds.some((id) => selected.has(id));

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }

  // --- bulk verify (IG-1) ---
  async function verifySelected() {
    const targets = rows
      .filter((r) => selected.has(r.id))
      .map((r) => ({ id: r.id, labelImage: r.labelImage }));
    if (targets.length === 0) return;

    setVerifying(true);
    setVerifyTotal(targets.length);
    setBulkError(null);
    setBulkMessage(null);
    try {
      // Each persisted verdict fires VERDICTS_CHANGED_EVENT → our listener refreshes the "AI check"
      // column live as results land.
      const summary = await bulkVerify(targets);
      setBulkMessage(summarize(summary) || null);
      if (summary.error) setBulkError(summary.error);
      setSelected(new Set());
    } finally {
      setVerifying(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-10">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
          Label approvals
        </h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-300">
          Pending alcohol label applications awaiting compliance review. Open one to verify its label
          against the submitted filing, or select several and verify them in one pass.
        </p>
      </header>

      <section aria-label="Queue summary" className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Applications"
          value={rows.length}
          tone="blue"
          icon={<IconLayers className="h-5 w-5" />}
        />
        <StatTile
          label="Pending review"
          value={counts.pending}
          tone="slate"
          icon={<IconClock className="h-5 w-5" />}
        />
        <StatTile
          label="High priority"
          value={highPriorityPending}
          tone="amber"
          icon={<IconFlag className="h-5 w-5" />}
        />
        <StatTile
          label="Actioned"
          value={actioned}
          tone="green"
          icon={<IconCheckCircle className="h-5 w-5" />}
        />
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
        <label className="relative block">
          <span className="sr-only">Search applications</span>
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search brand, product, or COLA ID"
            className="w-64 max-w-full rounded-lg border border-neutral-300 bg-white py-2 pl-9 pr-3 text-sm text-neutral-900 focus:border-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
        </label>
      </div>

      {/* Bulk-verify action bar — appears once rows are selected. */}
      {(selected.size > 0 || verifying) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-900 dark:bg-blue-950/40">
          <span className="text-sm font-medium text-blue-900 dark:text-blue-200" aria-live="polite">
            {verifying
              ? `Verifying ${verifyTotal} label${verifyTotal === 1 ? "" : "s"}… running AI on each`
              : `${selected.size} selected`}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={verifySelected}
              disabled={verifying || selected.size === 0}
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:bg-neutral-400 dark:disabled:bg-neutral-700"
              aria-busy={verifying}
            >
              {verifying ? "Verifying…" : "Verify selected"}
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              disabled={verifying}
              className="rounded-lg px-3 py-2 text-sm font-medium text-blue-800 hover:bg-blue-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 dark:text-blue-300 dark:hover:bg-blue-900/40"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {(bulkMessage || bulkError) && !verifying && (
        <div className="mb-4" aria-live="polite">
          {bulkMessage && (
            <p className="rounded-lg border border-black/10 bg-neutral-50 px-4 py-2.5 text-sm text-neutral-700 dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-300">
              {bulkMessage}
            </p>
          )}
          {bulkError && (
            <p role="alert" className="mt-2 rounded-lg border border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200">
              {bulkError}
            </p>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/10">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
            <tr>
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  aria-label="Select all shown applications"
                  className="h-4 w-4 accent-blue-700"
                  checked={allVisibleSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected;
                  }}
                  onChange={toggleAllVisible}
                  disabled={verifying || visibleIds.length === 0}
                />
              </th>
              <th className="w-8 px-4 py-3 font-medium">#</th>
              <th className="px-4 py-3 font-medium">Application</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">ABV</th>
              <th className="px-4 py-3 font-medium">Applicant</th>
              <th className="px-4 py-3 font-medium">Priority</th>
              <th className="px-4 py-3 font-medium">AI check</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-neutral-500">
                  Loading queue…
                </td>
              </tr>
            )}
            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-neutral-500">
                  {rows.length === 0
                    ? loadError
                      ? "Couldn't load the queue — please refresh."
                      : "No applications in the queue."
                    : "No applications match this view."}
                </td>
              </tr>
            )}
            {visible.map((r, i) => (
              <tr
                key={r.id}
                onClick={() => router.push(`/review/${r.id}`)}
                className="cursor-pointer border-t border-black/5 hover:bg-blue-50/60 dark:border-white/5 dark:hover:bg-blue-950/30"
              >
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${r.brandName}`}
                    className="h-4 w-4 accent-blue-700"
                    checked={selected.has(r.id)}
                    onChange={() => toggleRow(r.id)}
                    disabled={verifying}
                  />
                </td>
                <td className="px-4 py-3 tabular-nums text-neutral-400">{i + 1}</td>
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
                <td className="px-4 py-3">
                  <TypeBadge category={r.category} />
                </td>
                <td className="px-4 py-3 tabular-nums text-neutral-700 dark:text-neutral-300">
                  {r.alcoholContent}
                </td>
                <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">
                  {applicantName(r.producerNameAddress)}
                </td>
                <td className="px-4 py-3">
                  {r.priority === "high" ? (
                    <span className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400">
                      <IconFlag className="h-3.5 w-3.5" /> High
                    </span>
                  ) : (
                    <span className="text-neutral-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <AiCheckBadge verdict={verdicts[r.id]} />
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

/** Producer/importer shown in the queue's Applicant column — just the entity name, no address. */
function applicantName(producer?: string | null): string {
  if (!producer) return "—";
  return producer.split(",")[0].trim();
}

const STAT_ICON_TONES = {
  neutral: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300",
  slate: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  green: "bg-green-100 text-green-700 dark:bg-green-950/60 dark:text-green-300",
} as const;

function StatTile({
  label,
  value,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: number;
  icon?: ReactNode;
  tone?: keyof typeof STAT_ICON_TONES;
}) {
  const valueCls =
    tone === "amber"
      ? "text-amber-700 dark:text-amber-400"
      : tone === "green"
        ? "text-green-700 dark:text-green-400"
        : "text-neutral-900 dark:text-neutral-100";
  return (
    <div className="flex items-center gap-3 rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-neutral-900">
      {icon && (
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${STAT_ICON_TONES[tone]}`}>
          {icon}
        </span>
      )}
      <div>
        <div className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          {label}
        </div>
        <div className={`mt-0.5 text-2xl font-bold tabular-nums ${valueCls}`}>{value}</div>
      </div>
    </div>
  );
}

/** Color-coded beverage-type pill (Spirits / Wine / Beer). */
function TypeBadge({ category }: { category: string }) {
  const cls =
    category === "Spirits"
      ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
      : category === "Wine"
        ? "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300"
        : category === "Beer"
          ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/50 dark:text-yellow-300"
          : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";
  return (
    <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>
      {category}
    </span>
  );
}

/** The persisted AI recommendation for a row — or "Not run" when it hasn't been verified yet. */
function AiCheckBadge({ verdict }: { verdict?: StoredVerdict }) {
  if (!verdict) return <span className="text-neutral-400">Not run</span>;
  const { level, label } = verdict.recommendation;
  const cls =
    level === "approve"
      ? "text-green-700 dark:text-green-400"
      : level === "reject"
        ? "text-red-700 dark:text-red-400"
        : "text-amber-700 dark:text-amber-400";
  const short = level === "approve" ? "Ready" : level === "reject" ? "Likely rejection" : "Needs review";
  return (
    <span
      className={`inline-flex items-center gap-1 font-medium ${cls}`}
      title={`${label} · verified ${new Date(verdict.verifiedAt).toLocaleString()}`}
    >
      <span aria-hidden>●</span> {short}
    </span>
  );
}

function StatusBadge({ status }: { status: Disposition }) {
  const cls: Record<Disposition, string> = {
    pending: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200",
    approved: "bg-green-700 text-white",
    rejected: "bg-red-700 text-white",
    "needs-info": "bg-amber-500 text-black",
  };
  const sym: Record<Disposition, string> = {
    pending: "○",
    approved: "✓",
    rejected: "✕",
    "needs-info": "ℹ",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${cls[status]}`}
    >
      <span aria-hidden>{sym[status]}</span>
      {DISPOSITION_LABEL[status]}
    </span>
  );
}
