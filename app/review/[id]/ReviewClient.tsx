"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Application } from "@/lib/applications";
import {
  recommendationFor,
  type ReviewResponse,
  type ReviewResult,
  type RecommendationResult,
} from "@/lib/matcher";
import { FieldResultCard } from "@/components/FieldResultCard";
import {
  getDisposition,
  setDisposition,
  DISPOSITION_LABEL,
  type Disposition,
} from "@/lib/dispositions";
import { getVerdict, setVerdict } from "@/lib/verdicts";

const APP_FIELDS: { key: keyof Application; label: string }[] = [
  { key: "brandName", label: "Brand name" },
  { key: "classType", label: "Class / type" },
  { key: "alcoholContent", label: "Alcohol content" },
  { key: "netContents", label: "Net contents" },
  { key: "producerNameAddress", label: "Producer name & address" },
  { key: "countryOfOrigin", label: "Country of origin" },
];

/** The verification result the page renders — either freshly run or restored from a saved verdict. */
type ShownResult = { review: ReviewResult; totalMs?: number; verifiedAt: number };

export function ReviewClient({ app }: { app: Application }) {
  const [result, setResult] = useState<ShownResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disposition, setDispositionState] = useState<Disposition>("pending");
  const resultsRef = useRef<HTMLElement>(null);
  // Only pull focus to the results after an explicit run — not when we restore a saved verdict on
  // load, which would yank focus on every page open.
  const focusAfterRun = useRef(false);

  // Restore per-application view state whenever the route's application changes: the human
  // disposition and the last AI verdict (so reopening shows the prior result without re-running).
  useEffect(() => {
    setDispositionState(getDisposition(app.id));
    const saved = getVerdict(app.id);
    setResult(saved ? { review: saved.review, totalMs: saved.totalMs, verifiedAt: saved.verifiedAt } : null);
    setError(null);
    setLoading(false);
  }, [app.id]);

  // Move focus to the results once a *fresh* verification returns (helps keyboard/low-vision users).
  useEffect(() => {
    if (result && focusAfterRun.current) {
      focusAfterRun.current = false;
      resultsRef.current?.focus();
    }
  }, [result]);

  async function runVerification() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const imgRes = await fetch(app.labelImage);
      if (!imgRes.ok) {
        setError("Could not load the label image for this application.");
        return;
      }
      const blob = await imgRes.blob();
      const file = new File([blob], app.labelImage.split("/").pop() ?? "label.png", {
        type: blob.type || "image/png",
      });
      const fd = new FormData();
      fd.append("image", file);
      fd.append("mode", "application");
      fd.append("applicationId", app.id);

      const res = await fetch("/api/review", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong while verifying the label.");
      } else {
        const payload = data as ReviewResponse;
        const verifiedAt = Date.now();
        focusAfterRun.current = true;
        setResult({ review: payload.review, totalMs: payload.timing?.totalMs, verifiedAt });
        // Persist so the queue's verdict pill fills in and reopening restores this result.
        setVerdict(app.id, {
          recommendation: recommendationFor(payload.review),
          review: payload.review,
          verifiedAt,
          totalMs: payload.timing?.totalMs,
        });
      }
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function applyDisposition(value: Disposition) {
    setDisposition(app.id, value);
    setDispositionState(value);
  }

  const rec: RecommendationResult | null = result ? recommendationFor(result.review) : null;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-10">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline dark:text-blue-400"
      >
        ← Back to queue
      </Link>

      <header className="mt-3 mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
            {app.brandName}
          </h1>
          <p className="mt-1 text-neutral-600 dark:text-neutral-300">
            {app.ttbId} · {app.productName} · {app.category}
          </p>
        </div>
        <span className="rounded-full bg-neutral-200 px-3 py-1.5 text-sm font-semibold text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200">
          {DISPOSITION_LABEL[disposition]}
        </span>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Submitted application data */}
        <section
          aria-labelledby="app-data"
          className="rounded-xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-neutral-900"
        >
          <h2 id="app-data" className="mb-3 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Submitted application
          </h2>
          <dl className="space-y-2 text-sm">
            {APP_FIELDS.map((f) => (
              <div key={f.key} className="grid grid-cols-3 gap-2">
                <dt className="text-neutral-500 dark:text-neutral-400">{f.label}</dt>
                <dd className="col-span-2 text-neutral-900 dark:text-neutral-100">
                  {String(app[f.key] ?? "—")}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Submitted label image */}
        <section
          aria-labelledby="label-img"
          className="rounded-xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-neutral-900"
        >
          <h2 id="label-img" className="mb-3 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Submitted label
          </h2>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={app.labelImage}
            alt={`Label submitted for ${app.brandName}`}
            className="mx-auto max-h-[420px] w-auto rounded-lg border border-black/10 dark:border-white/10"
          />
        </section>
      </div>

      {/* Verify action */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          onClick={runVerification}
          disabled={loading}
          className="rounded-xl bg-blue-700 px-6 py-3 text-base font-semibold text-white shadow-sm hover:bg-blue-800 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/50 disabled:cursor-not-allowed disabled:bg-neutral-400 dark:disabled:bg-neutral-700"
          aria-busy={loading}
        >
          {loading ? "Verifying label…" : result ? "Re-run AI verification" : "Run AI verification"}
        </button>
        {result && !loading && (
          <span className="text-sm text-neutral-500 dark:text-neutral-400">
            Last verified {formatWhen(result.verifiedAt)}
          </span>
        )}
      </div>

      {/* Results */}
      <div className="mt-8" aria-live="polite">
        {error && (
          <div
            role="alert"
            className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-900 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200"
          >
            <p className="font-semibold">We hit a problem</p>
            <p className="mt-1 text-sm">{error}</p>
          </div>
        )}

        {result && rec && (
          <section aria-labelledby="results" ref={resultsRef} tabIndex={-1} className="focus:outline-none">
            <RecommendationBanner rec={rec} />

            {result.review.imageQuality === "partial" && rec.level !== "image" && (
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                Some of the label was hard to read — double-check the flagged fields, or request a clearer photo.
              </p>
            )}

            <h2 id="results" className="mt-6 mb-3 text-xl font-bold text-neutral-900 dark:text-neutral-50">
              Field-by-field
              {typeof result.totalMs === "number" && (
                <span className="ml-2 text-sm font-normal text-neutral-400">
                  analyzed in {(result.totalMs / 1000).toFixed(1)}s
                </span>
              )}
            </h2>
            <ul className="space-y-3">
              {result.review.fields.map((field) => (
                <FieldResultCard key={field.key} field={field} />
              ))}
            </ul>

            {/* Disposition */}
            <section
              aria-labelledby="disposition"
              className="mt-8 rounded-xl border border-black/10 bg-neutral-50 p-5 dark:border-white/10 dark:bg-neutral-900"
            >
              <h2 id="disposition" className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                Record your decision
              </h2>
              <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
                Saved to this browser for the prototype. Current: <strong>{DISPOSITION_LABEL[disposition]}</strong>
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => applyDisposition("approved")}
                  className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                >
                  ✓ Approve
                </button>
                <button
                  onClick={() => applyDisposition("needs-info")}
                  className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-black hover:bg-amber-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                >
                  Request info
                </button>
                <button
                  onClick={() => applyDisposition("rejected")}
                  className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                >
                  ✕ Reject
                </button>
                {disposition !== "pending" && (
                  <button
                    onClick={() => applyDisposition("pending")}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  >
                    Reset to pending
                  </button>
                )}
              </div>
            </section>
          </section>
        )}
      </div>
    </main>
  );
}

/** Compact relative-ish timestamp for "last verified". Falls back to a locale date for older runs. */
function formatWhen(ts: number): string {
  const diffSec = Math.round((Date.now() - ts) / 1000);
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) {
    const m = Math.floor(diffSec / 60);
    return `${m} minute${m === 1 ? "" : "s"} ago`;
  }
  if (diffSec < 86400) {
    const h = Math.floor(diffSec / 3600);
    return `${h} hour${h === 1 ? "" : "s"} ago`;
  }
  return new Date(ts).toLocaleString();
}

function RecommendationBanner({ rec }: { rec: RecommendationResult }) {
  const cls =
    rec.level === "approve"
      ? "border-green-300 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200"
      : rec.level === "reject"
        ? "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
        : rec.level === "image"
          ? "border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200"
          : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200";
  return (
    <div className={`rounded-xl border p-4 ${cls}`}>
      <p className="text-sm font-medium uppercase tracking-wide opacity-70">Recommendation</p>
      <p className="mt-0.5 text-2xl font-bold">{rec.label}</p>
      <p className="mt-1 text-sm">{rec.reason}</p>
    </div>
  );
}
