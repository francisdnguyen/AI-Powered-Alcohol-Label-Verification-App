"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  loadDispositions,
  DISPOSITION_LABEL,
  type Disposition,
} from "@/lib/dispositions";
import {
  loadVerdicts,
  setVerdict,
  VERDICTS_CHANGED_EVENT,
  type StoredVerdict,
} from "@/lib/verdicts";
import { recommendationFor } from "@/lib/matcher";
import { downscaleImage } from "@/lib/imageClient";
import type { BatchFileResult } from "@/lib/batch";
import type { ApplicationSummary } from "@/lib/applications";

type StatusFilter = "all" | Disposition;

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "needs-info", label: "Needs info" },
];

// Bulk verify reuses the batch pipeline: per-chunk byte budget (under Vercel's ~4.5 MB body limit)
// and file cap (matches the server's MAX_BATCH_FILES). The queue is small today, so this is almost
// always one request — the chunking just keeps it correct if the seed list grows past a chunk.
const CHUNK_MAX_BYTES = 3.6 * 1024 * 1024;
const CHUNK_MAX_COUNT = 20;

type VerifyPair = { file: File; id: string };

/** Split label/app pairs into request-sized chunks under both a byte budget and a count cap. */
function chunkPairs(pairs: VerifyPair[], maxBytes: number, maxCount: number): VerifyPair[][] {
  const chunks: VerifyPair[][] = [];
  let current: VerifyPair[] = [];
  let bytes = 0;
  for (const p of pairs) {
    const exceedsBytes = bytes + p.file.size > maxBytes && current.length > 0;
    const exceedsCount = current.length >= maxCount;
    if (exceedsBytes || exceedsCount) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(p);
    bytes += p.file.size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

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
  const unverified = useMemo(
    () => rows.filter((r) => !verdicts[r.id]).length,
    [rows, verdicts],
  );

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
    const ids = rows.filter((r) => selected.has(r.id)).map((r) => r.id);
    if (ids.length === 0) return;

    setVerifying(true);
    setVerifyTotal(ids.length);
    setBulkError(null);
    setBulkMessage(null);

    try {
      // Fetch + downscale each selected label into a File paired with its application id. The same
      // client-fetch path single review uses, so we never touch the serverless filesystem.
      const rowById = new Map(rows.map((r) => [r.id, r]));
      const pairs: VerifyPair[] = [];
      let fetchFailed = 0;
      for (const id of ids) {
        const row = rowById.get(id);
        if (!row) continue;
        try {
          const res = await fetch(row.labelImage);
          if (!res.ok) {
            fetchFailed++;
            continue;
          }
          const blob = await res.blob();
          const raw = new File([blob], row.labelImage.split("/").pop() ?? `${id}.png`, {
            type: blob.type || "image/png",
          });
          pairs.push({ file: await downscaleImage(raw), id });
        } catch {
          fetchFailed++;
        }
      }

      const tally = { approve: 0, review: 0, reject: 0 };
      let failed = fetchFailed;

      const chunks = chunkPairs(pairs, CHUNK_MAX_BYTES, CHUNK_MAX_COUNT);
      for (const chunk of chunks) {
        const fd = new FormData();
        for (const p of chunk) {
          fd.append("images", p.file);
          fd.append("applicationIds", p.id);
        }
        fd.append("mode", "queue");
        try {
          const res = await fetch("/api/batch", { method: "POST", body: fd });
          const data = await res.json();
          if (!res.ok || !Array.isArray(data.files)) {
            failed += chunk.length;
            setBulkError(data?.error || `Verification failed (${res.status}).`);
            continue;
          }
          for (const f of data.files as BatchFileResult[]) {
            if (f.status === "done" && f.review && f.applicationId) {
              const recommendation = recommendationFor(f.review);
              // Writing the verdict fires VERDICTS_CHANGED_EVENT → the "AI check" column updates live.
              setVerdict(f.applicationId, {
                recommendation,
                review: f.review,
                verifiedAt: Date.now(),
                totalMs: f.timingMs,
              });
              tally[recommendation.level]++;
            } else {
              failed++;
            }
          }
        } catch {
          failed += chunk.length;
          setBulkError("Could not reach the server while verifying.");
        }
      }

      const ok = tally.approve + tally.review + tally.reject;
      const parts: string[] = [];
      if (tally.approve) parts.push(`${tally.approve} ready`);
      if (tally.review) parts.push(`${tally.review} need review`);
      if (tally.reject) parts.push(`${tally.reject} likely rejection`);
      let msg = ok > 0 ? `Verified ${ok} label${ok === 1 ? "" : "s"}` : "";
      if (parts.length) msg += ` — ${parts.join(", ")}`;
      if (failed > 0) msg += `${ok > 0 ? "; " : ""}${failed} could not be checked`;
      setBulkMessage(msg || null);
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
        <StatTile label="Applications" value={rows.length} />
        <StatTile label="Not AI-checked" value={unverified} />
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
              <th className="px-4 py-3 font-medium">Application</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">ABV</th>
              <th className="px-4 py-3 font-medium">Priority</th>
              <th className="px-4 py-3 font-medium">AI check</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-neutral-500">
                  Loading queue…
                </td>
              </tr>
            )}
            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-neutral-500">
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
  return (
    <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${cls[status]}`}>
      {DISPOSITION_LABEL[status]}
    </span>
  );
}
