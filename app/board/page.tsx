"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  loadVerdicts,
  VERDICTS_CHANGED_EVENT,
  type StoredVerdict,
} from "@/lib/verdicts";
import { bulkVerify, summarize } from "@/lib/bulkVerify";
import type { ApplicationSummary } from "@/lib/applications";

/**
 * Match board — a visual, at-a-glance version of the queue. Each preloaded application is shown as a
 * card with its submitted label image, and the AI scans each label against its own filing to show a
 * match verdict right on the card. Unscanned labels are auto-scanned once on load (bounded to the
 * seeded set); results persist via `lib/verdicts.ts`, so re-opening the board — or the queue — reuses
 * them instead of re-spending on the model. The verdict is advisory; dispositions still happen on the
 * per-application review page.
 */
export default function BoardPage() {
  const [apps, setApps] = useState<ApplicationSummary[]>([]);
  const [verdicts, setVerdicts] = useState<Record<string, StoredVerdict>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoRan = useRef(false);

  useEffect(() => {
    fetch("/api/applications")
      .then((r) => r.json())
      .then((d: { applications?: ApplicationSummary[] }) => setApps(d.applications ?? []))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const refresh = () => setVerdicts(loadVerdicts());
    refresh();
    window.addEventListener(VERDICTS_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(VERDICTS_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  async function scan(targets: ApplicationSummary[]) {
    if (targets.length === 0 || scanning) return;
    setScanning(true);
    setError(null);
    setMessage(null);
    let done = 0;
    setProgress({ done, total: targets.length });
    const summary = await bulkVerify(
      targets.map((t) => ({ id: t.id, labelImage: t.labelImage })),
      () => {
        done += 1;
        setProgress({ done, total: targets.length });
        setVerdicts(loadVerdicts());
      },
    );
    setProgress(null);
    setScanning(false);
    setMessage(summarize(summary) || null);
    if (summary.error) setError(summary.error);
  }

  // Auto-scan any not-yet-scanned labels once the cards are loaded — the board's whole point is that
  // the AI has already checked them. Persisted verdicts mean this only spends on genuinely new items;
  // the ref guards against a re-run (incl. React Strict Mode's double effect invoke).
  useEffect(() => {
    if (loading || apps.length === 0 || autoRan.current) return;
    autoRan.current = true;
    const stored = loadVerdicts();
    const unscanned = apps.filter((a) => !stored[a.id]);
    if (unscanned.length > 0) scan(unscanned);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, apps]);

  const scannedCount = apps.filter((a) => verdicts[a.id]).length;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-10">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
            Match board
          </h1>
          <p className="mt-2 max-w-2xl text-neutral-600 dark:text-neutral-300">
            Every pending application with its submitted label. The AI scans each label against its
            filing and shows the match verdict here — no uploads, nothing to click. Open a card for the
            field-by-field detail and to record a decision.
          </p>
        </div>
        <button
          type="button"
          onClick={() => scan(apps)}
          disabled={scanning || apps.length === 0}
          className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:bg-neutral-400 dark:disabled:bg-neutral-700"
          aria-busy={scanning}
        >
          {scanning ? "Scanning…" : "Re-scan all"}
        </button>
      </header>

      <div className="mb-5 min-h-[1.5rem] text-sm" aria-live="polite">
        {scanning && progress ? (
          <p className="font-medium text-blue-800 dark:text-blue-300">
            Scanning labels… {progress.done}/{progress.total} checked
          </p>
        ) : message ? (
          <p className="text-neutral-600 dark:text-neutral-300">{message}</p>
        ) : (
          !loading &&
          apps.length > 0 && (
            <p className="text-neutral-500 dark:text-neutral-400">
              {scannedCount} of {apps.length} labels scanned
            </p>
          )
        )}
        {error && (
          <p role="alert" className="mt-1 text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
      </div>

      {loading ? (
        <p className="py-16 text-center text-neutral-500">Loading applications…</p>
      ) : apps.length === 0 ? (
        <p className="py-16 text-center text-neutral-500">
          {loadError ? "Couldn't load applications — please refresh." : "No applications to show."}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {apps.map((a) => (
            <BoardCard
              key={a.id}
              app={a}
              verdict={verdicts[a.id]}
              scanning={scanning}
              onScan={() => scan([a])}
            />
          ))}
        </ul>
      )}
    </main>
  );
}

function BoardCard({
  app,
  verdict,
  scanning,
  onScan,
}: {
  app: ApplicationSummary;
  verdict?: StoredVerdict;
  scanning: boolean;
  onScan: () => void;
}) {
  return (
    <li className="flex flex-col overflow-hidden rounded-xl border border-black/10 bg-white dark:border-white/10 dark:bg-neutral-900">
      <div className="flex h-40 items-center justify-center border-b border-black/5 bg-neutral-50 p-2 dark:border-white/5 dark:bg-neutral-950">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={app.labelImage}
          alt={`Submitted label for ${app.brandName}`}
          loading="lazy"
          className="max-h-full w-auto rounded"
        />
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate font-semibold text-neutral-900 dark:text-neutral-100">
              {app.brandName}
            </h2>
            <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
              {app.ttbId} · {app.category} · {app.alcoholContent}
            </p>
          </div>
          {app.priority === "high" && (
            <span className="shrink-0 text-xs font-medium text-amber-700 dark:text-amber-400">
              ● High
            </span>
          )}
        </div>

        <div className="mt-3">
          <VerdictBadge verdict={verdict} />
          {verdict && (
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              {verdict.recommendation.reason}
            </p>
          )}
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 pt-4">
          <Link
            href={`/review/${app.id}`}
            className="text-sm font-medium text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-400"
          >
            Open review →
          </Link>
          <button
            type="button"
            onClick={onScan}
            disabled={scanning}
            className="rounded-lg px-2.5 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {verdict ? "Re-scan" : "Scan"}
          </button>
        </div>
      </div>
    </li>
  );
}

function VerdictBadge({ verdict }: { verdict?: StoredVerdict }) {
  if (!verdict) {
    return (
      <span className="inline-block rounded-full bg-neutral-200 px-2.5 py-1 text-xs font-semibold text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
        Not scanned
      </span>
    );
  }
  const { level, label } = verdict.recommendation;
  const cls =
    level === "approve"
      ? "bg-green-700 text-white"
      : level === "reject"
        ? "bg-red-700 text-white"
        : "bg-amber-500 text-black";
  return (
    <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>{label}</span>
  );
}
