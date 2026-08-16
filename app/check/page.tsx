"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { BeverageCategory, ReviewMode, ReviewResponse } from "@/lib/matcher";
import type { BatchFileResult } from "@/lib/batch";
import { downscaleImage, chunkFiles } from "@/lib/imageClient";
import { CHUNK_MAX_BYTES, CHUNK_MAX_COUNT } from "@/lib/batchLimits";
import { setDisposition } from "@/lib/dispositions";
import { FieldResultCard } from "@/components/FieldResultCard";
import type { ApplicationSummary } from "@/lib/applications";

/**
 * One adaptive check surface. The number of photos picks the flow:
 *   • exactly one  → a detailed single check (against a filing, your own values, or the label itself)
 *   • two or more  → a batch review (each label on its own, or all against one filing)
 * Backend is unchanged — a single check POSTs `/api/review`; a batch chunks into `/api/batch`.
 */

const MANUAL_FIELDS = [
  { key: "brandName", label: "Brand name" },
  { key: "classType", label: "Class / type designation" },
  { key: "alcoholContent", label: "Alcohol content" },
  { key: "netContents", label: "Net contents" },
  { key: "producerNameAddress", label: "Producer name & address" },
  { key: "countryOfOrigin", label: "Country of origin" },
] as const;

/** Whole-batch cap (top of the stakeholders' 200-300 ask). Enforced client-side. */
const MAX_TOTAL_FILES = 300;
/** How many chunk POSTs are in flight at once — paces the per-IP rate limit and Claude fan-out. */
const CHUNK_CONCURRENCY = 3;

type BatchMode = "self" | "application";

/** An agent's recorded call on a checked label. Session-local on this ad-hoc page. */
type DecisionChoice = "approved" | "needs-info" | "rejected";
interface Decision {
  choice: DecisionChoice | null;
  note: string;
  submitted: boolean;
}

const DECISION_META: Record<
  DecisionChoice,
  { button: string; recorded: string; activeClass: string; idleClass: string; pill: string }
> = {
  approved: {
    button: "✓ Approve",
    recorded: "Approved",
    activeClass: "bg-green-700 text-white",
    idleClass: "border border-green-600 text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-950/40",
    pill: "bg-green-700 text-white",
  },
  "needs-info": {
    button: "Flag for Review",
    recorded: "Flagged for review",
    activeClass: "bg-amber-500 text-black",
    idleClass: "border border-amber-500 text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/40",
    pill: "bg-amber-500 text-black",
  },
  rejected: {
    button: "✕ Reject",
    recorded: "Rejected",
    activeClass: "bg-red-700 text-white",
    idleClass: "border border-red-600 text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40",
    pill: "bg-red-700 text-white",
  },
};

/** Run `worker` over items with at most `limit` in flight; returns results in order. */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        out[i] = await worker(items[i], i);
      }
    }),
  );
  return out;
}

export default function CheckPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [applications, setApplications] = useState<ApplicationSummary[]>([]);
  const [applicationId, setApplicationId] = useState("");

  // Single-check state.
  const [mode, setMode] = useState<ReviewMode>("application");
  const [manual, setManual] = useState<Record<string, string>>({});
  // Expected beverage family for a manual check: "auto" trusts what we detect from the label's
  // class/type; an explicit pick is compared against that detection.
  const [expectedBeverage, setExpectedBeverage] = useState<"auto" | BeverageCategory>("auto");
  const [result, setResult] = useState<ReviewResponse | null>(null);

  // Batch state (its own mode, so it never collides with the single-check modes).
  const [batchMode, setBatchMode] = useState<BatchMode>("self");
  const [batchResults, setBatchResults] = useState<BatchFileResult[]>([]);
  const [total, setTotal] = useState(0);
  const [prep, setPrep] = useState<string | null>(null);
  const batchRef = useRef<BatchFileResult[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Agent decisions per result, keyed per label. Session-local: ad-hoc uploads aren't queue filings,
  // so these aren't written to the queue's disposition store (that lives on /review/[id]).
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  // The filing the *single* check was actually run against (application mode only). Non-null here is
  // what lets a submitted single decision write through to the queue's disposition store.
  const [checkedApplicationId, setCheckedApplicationId] = useState<string | null>(null);
  function updateDecision(key: string, patch: Partial<Decision>) {
    setDecisions((prev) => {
      const base: Decision = prev[key] ?? { choice: null, note: "", submitted: false };
      return { ...prev, [key]: { ...base, ...patch } };
    });
  }

  const isBatch = files.length > 1;

  useEffect(() => {
    fetch("/api/applications")
      .then((r) => r.json())
      .then((d: { applications?: ApplicationSummary[] }) => {
        setApplications(d.applications ?? []);
        if (d.applications?.[0]) setApplicationId(d.applications[0].id);
      })
      .catch(() => {});
  }, []);

  // A preview thumbnail only makes sense for exactly one image.
  useEffect(() => {
    if (files.length !== 1) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(files[0]);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [files]);

  // Move focus to the results region for a single check or an error (batch updates incrementally,
  // so it isn't focus-grabbed on every chunk).
  useEffect(() => {
    if (result || error) resultsRef.current?.focus();
  }, [result, error]);

  /** Accept a dropped/chosen list: keep only images, clear any prior run. Shared by input + drop. */
  function chooseFiles(list: FileList | null) {
    const picked = Array.from(list ?? []).filter((f) => f.type.startsWith("image/"));
    setResult(null);
    batchRef.current = [];
    setBatchResults([]);
    setTotal(0);
    setError(null);
    setDecisions({});
    setCheckedApplicationId(null);
    if (list && list.length > 0 && picked.length === 0) {
      setError("Please choose image files (JPEG, PNG, or WebP).");
      setFiles([]);
      return;
    }
    setFiles(picked);
  }

  /** Write a chunk's per-file results into the merged list at its global offset and re-render. */
  function mergeChunk(offset: number, chunk: BatchFileResult[]) {
    for (const f of chunk) {
      batchRef.current[offset + f.index] = { ...f, index: offset + f.index };
    }
    setBatchResults(batchRef.current.slice());
  }

  /** Mark a whole chunk's files as errored (the chunk request itself failed) and re-render. */
  function markChunkError(offset: number, count: number, message: string) {
    for (let i = 0; i < count; i++) {
      batchRef.current[offset + i] = {
        index: offset + i,
        filename: batchRef.current[offset + i]?.filename ?? "",
        status: "error",
        error: message,
      };
    }
    setBatchResults(batchRef.current.slice());
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (files.length === 0) {
      setError("Add at least one label photo.");
      return;
    }
    if (files.length > MAX_TOTAL_FILES) {
      setError(`Please upload at most ${MAX_TOTAL_FILES} files at once.`);
      return;
    }
    if (isBatch) return runBatch(files);
    return runSingle(files[0]);
  }

  async function runSingle(file: File) {
    if (mode === "manual" && !manual.brandName?.trim()) {
      setError('Enter at least the brand name to compare against, or choose "Just check the label itself".');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    setDecisions({});
    setCheckedApplicationId(null);

    // Shrink large photos in the browser so a multi-MB phone image doesn't hit Vercel's ~4.5 MB
    // request-body limit. Small images pass through untouched; downscaleImage never throws.
    const prepared = await downscaleImage(file);

    const fd = new FormData();
    fd.append("image", prepared);
    fd.append("mode", mode);
    if (mode === "application") fd.append("applicationId", applicationId);
    if (mode === "manual") {
      for (const { key } of MANUAL_FIELDS) {
        if (manual[key]?.trim()) fd.append(key, manual[key].trim());
      }
    }

    try {
      const res = await fetch("/api/review", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) setError(data.error || "Something went wrong while analyzing the label.");
      else {
        setResult(data as ReviewResponse);
        // Remember the filing this check was run against, so a decision can update the queue.
        setCheckedApplicationId(mode === "application" && applicationId ? applicationId : null);
      }
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function runBatch(all: File[]) {
    setBusy(true);
    setError(null);
    setBatchResults([]);
    setTotal(0);
    setDecisions({});
    setCheckedApplicationId(null);

    try {
      // 1. Shrink images in the browser so large photos fit the request-body limit.
      setPrep(`Preparing ${all.length} image${all.length === 1 ? "" : "s"}…`);
      const prepared = await mapPool(all, 4, downscaleImage);

      // 2. Split into request-sized chunks and seed the merged results list.
      const chunks = chunkFiles(prepared, CHUNK_MAX_BYTES, CHUNK_MAX_COUNT);
      batchRef.current = prepared.map((f, i) => ({ index: i, filename: f.name, status: "pending" }));
      setBatchResults(batchRef.current.slice());
      setTotal(prepared.length);

      // 3. POST each chunk (bounded concurrency); each processes synchronously and returns inline.
      let offset = 0;
      const descriptors = chunks.map((c) => {
        const d = { files: c, offset };
        offset += c.length;
        return d;
      });
      setPrep(
        `Analyzing ${prepared.length} label${prepared.length === 1 ? "" : "s"} in ${chunks.length} batch${chunks.length === 1 ? "" : "es"}…`,
      );

      let anyOk = false;
      await mapPool(descriptors, CHUNK_CONCURRENCY, async (d) => {
        const fd = new FormData();
        for (const f of d.files) fd.append("images", f);
        fd.append("mode", batchMode);
        if (batchMode === "application") fd.append("applicationId", applicationId);
        try {
          const res = await fetch("/api/batch", { method: "POST", body: fd });
          const data = await res.json();
          if (!res.ok) {
            markChunkError(d.offset, d.files.length, data.error || `Analysis failed (${res.status}).`);
            return;
          }
          anyOk = true;
          mergeChunk(d.offset, data.files as BatchFileResult[]);
        } catch {
          markChunkError(d.offset, d.files.length, "Could not reach the server.");
        }
      });

      setPrep(null);
      if (!anyOk) setError("None of the batches could be analyzed. Please try again in a moment.");
    } catch {
      setPrep(null);
      setError("Something went wrong preparing the batch.");
    } finally {
      setBusy(false);
    }
  }

  const seconds = result ? (result.timing.totalMs / 1000).toFixed(1) : null;
  const doneCount = batchResults.filter((f) => f.status === "done" || f.status === "error").length;
  const singleKey = `single:${files[0]?.name ?? "label"}`;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
          Check a label
        </h1>
        <p className="mt-2 text-lg text-neutral-600 dark:text-neutral-300">
          Add <strong>one</strong> photo for a detailed check against a filing or your own values, or{" "}
          <strong>several</strong> to review them together as a batch. We read the seven required
          fields and flag anything that doesn&apos;t match.
        </p>
      </header>

      <form onSubmit={onSubmit} noValidate>
        {/* Step 1: upload */}
        <section aria-labelledby="step-1" className="mb-8">
          <h2 id="step-1" className="mb-3 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
            1. Add label photo{isBatch ? "s" : ""}
          </h2>

          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              chooseFiles(e.dataTransfer.files);
            }}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-colors focus-within:ring-4 focus-within:ring-blue-500/40 ${
              dragging
                ? "border-blue-600 bg-blue-50 dark:bg-blue-950/40"
                : "border-neutral-300 bg-neutral-50 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
            }`}
          >
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="sr-only"
              onChange={(e) => chooseFiles(e.target.files)}
            />
            <span className="text-base font-medium text-neutral-800 dark:text-neutral-100">
              {files.length === 0
                ? "Tap to choose photos, or drag them here"
                : files.length === 1
                  ? "Choose a different photo"
                  : `${files.length} files selected — choose or drag again to replace`}
            </span>
            <span className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              JPEG, PNG, or WebP · one photo = a detailed check, several = a batch (up to {MAX_TOTAL_FILES})
            </span>
          </label>

          {files.length === 1 && previewUrl && (
            <div className="mt-4 flex items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl}
                alt="Preview of the label you uploaded"
                className="h-24 w-24 rounded-lg border border-black/10 object-cover dark:border-white/10"
              />
              <div className="text-sm text-neutral-600 dark:text-neutral-300">
                <p className="font-medium text-neutral-900 dark:text-neutral-100">{files[0]?.name}</p>
                <button
                  type="button"
                  onClick={() => chooseFiles(null)}
                  className="mt-1 rounded text-blue-700 underline underline-offset-2 hover:text-blue-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-400"
                >
                  Remove
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Step 2: what to check against — adapts to single vs batch */}
        <section aria-labelledby="step-2" className="mb-8">
          <h2 id="step-2" className="mb-3 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
            2. Check {isBatch ? "them" : "it"} against&hellip;
          </h2>

          {isBatch ? (
            <fieldset className="space-y-3">
              <legend className="sr-only">Batch comparison mode</legend>
              <ModeRadio
                name="bmode"
                value="self"
                checked={batchMode === "self"}
                onChange={() => setBatchMode("self")}
                title="Check each label on its own"
                desc="Read every label and verify its government warning and alcohol format."
              />
              <ModeRadio
                name="bmode"
                value="application"
                checked={batchMode === "application"}
                onChange={() => setBatchMode("application")}
                title="Match all against one application"
                desc="For a shipment of the same product — grade every photo against one filing."
              />
              {batchMode === "application" && (
                <AppSelect
                  applications={applications}
                  value={applicationId}
                  onChange={setApplicationId}
                />
              )}
            </fieldset>
          ) : (
            <fieldset className="space-y-3">
              <legend className="sr-only">What to compare the label against</legend>

              <ModeRadio
                value="application"
                checked={mode === "application"}
                onChange={() => setMode("application")}
                title="A submitted application"
                desc="Match the label to an application on file."
              />
              {mode === "application" && (
                <AppSelect
                  applications={applications}
                  value={applicationId}
                  onChange={setApplicationId}
                />
              )}

              <ModeRadio
                value="manual"
                checked={mode === "manual"}
                onChange={() => setMode("manual")}
                title="Values I type in"
                desc="Start with the brand name; add more fields only if you want to compare them."
              />
              {mode === "manual" && (
                <div className="ml-8 space-y-3">
                  {/* Brand leads; the rest stay behind a disclosure (progressive disclosure). */}
                  <ManualField
                    fieldKey="brandName"
                    label="Brand name (required)"
                    value={manual.brandName ?? ""}
                    onChange={(v) => setManual((m) => ({ ...m, brandName: v }))}
                  />
                  <div>
                    <label
                      htmlFor="beverageType"
                      className="block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                    >
                      Beverage type
                    </label>
                    <select
                      id="beverageType"
                      value={expectedBeverage}
                      onChange={(e) => setExpectedBeverage(e.target.value as "auto" | BeverageCategory)}
                      className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-neutral-900 focus:border-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 sm:w-64"
                    >
                      <option value="auto">Auto (detect from label)</option>
                      <option value="Beer">Beer</option>
                      <option value="Wine">Wine</option>
                      <option value="Spirits">Spirits</option>
                    </select>
                  </div>
                  <details className="rounded-lg border border-neutral-200 dark:border-neutral-800">
                    <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-400">
                      Add more label details (optional)
                    </summary>
                    <div className="grid grid-cols-1 gap-3 p-3 pt-1 sm:grid-cols-2">
                      {MANUAL_FIELDS.filter((f) => f.key !== "brandName").map((f) => (
                        <ManualField
                          key={f.key}
                          fieldKey={f.key}
                          label={f.label}
                          value={manual[f.key] ?? ""}
                          onChange={(v) => setManual((m) => ({ ...m, [f.key]: v }))}
                        />
                      ))}
                    </div>
                  </details>
                </div>
              )}

              <ModeRadio
                value="self"
                checked={mode === "self"}
                onChange={() => setMode("self")}
                title="Just check the label itself"
                desc="No application — we verify the government warning and alcohol format on their own."
              />
            </fieldset>
          )}
        </section>

        <button
          type="submit"
          disabled={busy || files.length === 0}
          className="w-full rounded-xl bg-blue-700 px-6 py-3.5 text-lg font-semibold text-white shadow-sm transition-colors hover:bg-blue-800 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/50 disabled:cursor-not-allowed disabled:bg-neutral-400 dark:disabled:bg-neutral-700"
          aria-busy={busy}
        >
          {busy
            ? isBatch
              ? "Analyzing batch…"
              : "Analyzing the label…"
            : isBatch
              ? `Run batch (${files.length})`
              : "Check this label"}
        </button>
      </form>

      {/* Results / errors */}
      <div ref={resultsRef} tabIndex={-1} className="mt-10 scroll-mt-4 focus:outline-none" aria-live="polite">
        {prep && (
          <p className="mb-4 text-sm font-medium text-neutral-600 dark:text-neutral-300">{prep}</p>
        )}

        {error && (
          <div
            role="alert"
            className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-900 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200"
          >
            <p className="font-semibold">We hit a problem</p>
            <p className="mt-1 text-sm">{error}</p>
          </div>
        )}

        {result && (
          <section aria-labelledby="results-heading">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="results-heading" className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
                Review results
              </h2>
              {seconds && (
                <p className="text-sm text-neutral-500 dark:text-neutral-400">Analyzed in {seconds}s</p>
              )}
            </div>
            <OverallBanner result={result} />
            <BeverageTypeNote
              detected={result.review.beverageType}
              expected={result.mode === "manual" ? expectedBeverage : "auto"}
            />
            <ul className="mt-4 space-y-3">
              {result.review.fields.map((f) => (
                <FieldResultCard key={f.key} field={f} />
              ))}
            </ul>
            <DecisionPanel
              value={decisions[singleKey]}
              onChange={(patch) => {
                updateDecision(singleKey, patch);
                // Single application-mode only: writing the decision through updates the filing's
                // status in the queue's disposition store (fires ttb-dispositions-changed).
                if (patch.submitted && checkedApplicationId) {
                  const choice = patch.choice ?? decisions[singleKey]?.choice;
                  if (choice) setDisposition(checkedApplicationId, choice);
                }
              }}
              queueLabel={
                checkedApplicationId ? "Saved to the queue — this filing's status was updated." : undefined
              }
            />
          </section>
        )}

        {batchResults.length > 0 && (
          <section aria-labelledby="b-results">
            <div className="flex items-baseline justify-between">
              <h2 id="b-results" className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
                Results
              </h2>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                {doneCount} of {total} done
              </p>
            </div>
            <ul className="mt-4 space-y-3">
              {batchResults.map((f) => {
                const key = `batch:${f.index}:${f.filename}`;
                return (
                  <BatchRow
                    key={f.index}
                    file={f}
                    decision={decisions[key]}
                    onDecisionChange={(patch) => updateDecision(key, patch)}
                  />
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}

function AppSelect({
  applications,
  value,
  onChange,
}: {
  applications: ApplicationSummary[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="ml-8">
      <label htmlFor="application" className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
        Application
      </label>
      <select
        id="application"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-neutral-900 focus:border-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
      >
        {applications.map((a) => (
          <option key={a.id} value={a.id}>
            {a.brandName} — {a.classType} ({a.ttbId})
          </option>
        ))}
      </select>
    </div>
  );
}

function ManualField({
  fieldKey,
  label,
  value,
  onChange,
}: {
  fieldKey: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={fieldKey} className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
        {label}
      </label>
      <input
        id={fieldKey}
        type="text"
        maxLength={300}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-neutral-900 focus:border-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
      />
    </div>
  );
}

function ModeRadio({
  name = "mode",
  value,
  checked,
  onChange,
  title,
  desc,
}: {
  name?: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  desc: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
        checked
          ? "border-blue-600 bg-blue-50 dark:border-blue-500 dark:bg-blue-950/40"
          : "border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
      }`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="mt-1 h-4 w-4 accent-blue-700 focus-visible:ring-2 focus-visible:ring-blue-500"
      />
      <span>
        <span className="block font-medium text-neutral-900 dark:text-neutral-100">{title}</span>
        <span className="block text-sm text-neutral-500 dark:text-neutral-400">{desc}</span>
      </span>
    </label>
  );
}

/**
 * Shows the beer/wine/spirits family we detected from the label's class/type, and — when the agent
 * picked an expected type rather than "Auto" — whether it agrees.
 */
function BeverageTypeNote({
  detected,
  expected,
}: {
  detected: BeverageCategory | null;
  expected: "auto" | BeverageCategory;
}) {
  if (!detected) {
    if (expected === "auto") return null;
    return (
      <p className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-2.5 text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
        Couldn&apos;t determine the beverage type from the label&apos;s class/type designation.
      </p>
    );
  }
  const mismatch = expected !== "auto" && expected !== detected;
  return (
    <p
      className={`mt-3 rounded-lg border px-4 py-2.5 text-sm ${
        mismatch
          ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
          : "border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300"
      }`}
    >
      Beverage type: <strong>{detected}</strong> (detected from the class/type designation).
      {mismatch && ` You selected ${expected} — the label looks like ${detected}.`}
    </p>
  );
}

function OverallBanner({ result }: { result: ReviewResponse }) {
  const { overall, summary } = result.review;
  const flagged = summary.mismatch + summary.missing + summary.review;
  if (overall === "pass") {
    return (
      <div className="mt-4 rounded-xl border border-green-300 bg-green-50 p-4 text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-100">
        <p className="font-semibold">✓ All seven fields match the application.</p>
      </div>
    );
  }
  return (
    <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
      <p className="font-semibold">
        {flagged} of {summary.total} field{flagged === 1 ? "" : "s"} need your attention.
      </p>
      <p className="mt-1 text-sm">
        {summary.mismatch} mismatch · {summary.missing} missing · {summary.review} to review
      </p>
    </div>
  );
}

function BatchRow({
  file,
  decision,
  onDecisionChange,
}: {
  file: BatchFileResult;
  decision?: Decision;
  onDecisionChange: (patch: Partial<Decision>) => void;
}) {
  const flagged = file.review
    ? file.review.summary.mismatch + file.review.summary.missing + file.review.summary.review
    : 0;
  const decided = decision?.submitted && decision.choice ? decision.choice : null;

  return (
    <li className="rounded-lg border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-neutral-900 dark:text-neutral-100">{file.filename}</span>
        <span className="flex items-center gap-2">
          {decided && (
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${DECISION_META[decided].pill}`}>
              {DECISION_META[decided].recorded}
            </span>
          )}
          <BatchStatus file={file} />
        </span>
      </div>

      {file.status === "error" && (
        <p className="mt-2 text-sm text-red-700 dark:text-red-300">{file.error}</p>
      )}

      {file.review && (
        <>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
            {file.overall === "pass"
              ? "All fields match."
              : `${flagged} field${flagged === 1 ? "" : "s"} need attention.`}
            {typeof file.timingMs === "number" && (
              <span className="text-neutral-400"> · {(file.timingMs / 1000).toFixed(1)}s</span>
            )}
          </p>
          <details className="mt-2">
            <summary className="cursor-pointer text-sm font-medium text-blue-700 hover:underline dark:text-blue-400">
              View field details
            </summary>
            <ul className="mt-3 space-y-3">
              {file.review.fields.map((fld) => (
                <FieldResultCard key={fld.key} field={fld} />
              ))}
            </ul>
          </details>
          <DecisionPanel value={decision} onChange={onDecisionChange} />
        </>
      )}
    </li>
  );
}

/**
 * Approve / Flag for Review / Reject with an optional note, then Submit. Session-local — records the
 * agent's call for this result without writing to the queue's filing dispositions. Once submitted it
 * collapses to a recorded banner with an Edit affordance.
 */
function DecisionPanel({
  value,
  onChange,
  queueLabel,
}: {
  value?: Decision;
  onChange: (patch: Partial<Decision>) => void;
  /** When set, shown after submit to confirm the decision also updated a queue filing. */
  queueLabel?: string;
}) {
  const d = value ?? { choice: null, note: "", submitted: false };

  if (d.submitted && d.choice) {
    const meta = DECISION_META[d.choice];
    return (
      <div className="mt-4 rounded-xl border border-black/10 bg-neutral-50 p-4 dark:border-white/10 dark:bg-neutral-900">
        <p className="text-sm text-neutral-800 dark:text-neutral-200">
          <span className="font-semibold">Decision recorded:</span> {meta.recorded}
        </p>
        {d.note.trim() && (
          <p className="mt-1 text-sm italic text-neutral-600 dark:text-neutral-400">“{d.note.trim()}”</p>
        )}
        {queueLabel && (
          <p className="mt-1 text-xs font-medium text-green-700 dark:text-green-400">{queueLabel}</p>
        )}
        <button
          type="button"
          onClick={() => onChange({ submitted: false })}
          className="mt-2 rounded text-sm font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-400"
        >
          Edit decision
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-black/10 bg-neutral-50 p-4 dark:border-white/10 dark:bg-neutral-900">
      <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Record your decision</h3>
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">Recorded for this session.</p>
      <div className="flex flex-wrap gap-2">
        {(["approved", "needs-info", "rejected"] as DecisionChoice[]).map((c) => {
          const meta = DECISION_META[c];
          const active = d.choice === c;
          return (
            <button
              key={c}
              type="button"
              aria-pressed={active}
              onClick={() => onChange({ choice: c })}
              className={`rounded-lg px-4 py-2 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                active ? meta.activeClass : meta.idleClass
              }`}
            >
              {meta.button}
            </button>
          );
        })}
      </div>
      <textarea
        value={d.note}
        onChange={(e) => onChange({ note: e.target.value })}
        placeholder="Add a note (optional)"
        aria-label="Decision note"
        rows={2}
        maxLength={500}
        className="mt-3 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
      />
      <button
        type="button"
        disabled={!d.choice}
        onClick={() => onChange({ submitted: true })}
        className="mt-3 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:bg-neutral-400 dark:disabled:bg-neutral-700"
      >
        Submit decision
      </button>
    </div>
  );
}

function BatchStatus({ file }: { file: BatchFileResult }) {
  if (file.status === "done") {
    const pass = file.overall === "pass";
    return (
      <span
        className={`rounded-full px-3 py-1 text-sm font-semibold ${
          pass ? "bg-green-700 text-white" : "bg-amber-500 text-black"
        }`}
      >
        {pass ? "✓ Pass" : "Needs attention"}
      </span>
    );
  }
  if (file.status === "error") {
    return <span className="rounded-full bg-red-700 px-3 py-1 text-sm font-semibold text-white">Error</span>;
  }
  return <span className="rounded-full bg-blue-700 px-3 py-1 text-sm font-semibold text-white">Analyzing…</span>;
}
