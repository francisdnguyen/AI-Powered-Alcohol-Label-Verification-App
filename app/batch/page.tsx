"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { BatchFileResult } from "@/lib/batch";
import { downscaleImage, chunkFiles } from "@/lib/imageClient";
import { FieldResultCard } from "@/components/FieldResultCard";
import type { ApplicationSummary } from "@/lib/applications";

type BatchMode = "self" | "application";

/** Whole-batch cap (top of the stakeholders' 200-300 ask). Enforced here on the client. */
const MAX_TOTAL_FILES = 300;
/** Per-chunk byte budget — kept under Vercel's ~4.5 MB request-body limit with margin. */
const CHUNK_MAX_BYTES = 3.6 * 1024 * 1024;
/** Per-chunk file cap — must match the server's MAX_BATCH_FILES (20). */
const CHUNK_MAX_COUNT = 20;
/** How many chunk POSTs are in flight at once — paces the per-IP rate limit and Claude fan-out. */
const CHUNK_CONCURRENCY = 3;

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

export default function BatchPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [mode, setMode] = useState<BatchMode>("self");
  const [applications, setApplications] = useState<ApplicationSummary[]>([]);
  const [applicationId, setApplicationId] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prep, setPrep] = useState<string | null>(null);
  const [results, setResults] = useState<BatchFileResult[]>([]);
  const [total, setTotal] = useState(0);
  const resultsRef = useRef<BatchFileResult[]>([]);

  useEffect(() => {
    fetch("/api/applications")
      .then((r) => r.json())
      .then((d: { applications?: ApplicationSummary[] }) => {
        setApplications(d.applications ?? []);
        if (d.applications?.[0]) setApplicationId(d.applications[0].id);
      })
      .catch(() => {});
  }, []);

  /** Write a chunk's per-file results into the merged list at its global offset and re-render. */
  function mergeChunk(offset: number, files: BatchFileResult[]) {
    for (const f of files) {
      resultsRef.current[offset + f.index] = { ...f, index: offset + f.index };
    }
    setResults(resultsRef.current.slice());
  }

  /** Mark a whole chunk's files as errored (the chunk request itself failed) and re-render. */
  function markChunkError(offset: number, count: number, message: string) {
    for (let i = 0; i < count; i++) {
      resultsRef.current[offset + i] = {
        index: offset + i,
        filename: resultsRef.current[offset + i]?.filename ?? "",
        status: "error",
        error: message,
      };
    }
    setResults(resultsRef.current.slice());
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
    setRunning(true);
    setError(null);
    setResults([]);
    setTotal(0);

    try {
      // 1. Shrink images in the browser so large photos fit the request-body limit.
      setPrep(`Preparing ${files.length} image${files.length === 1 ? "" : "s"}…`);
      const prepared = await mapPool(files, 4, downscaleImage);

      // 2. Split into request-sized chunks and seed the merged results list.
      const chunks = chunkFiles(prepared, CHUNK_MAX_BYTES, CHUNK_MAX_COUNT);
      resultsRef.current = prepared.map((f, i) => ({
        index: i,
        filename: f.name,
        status: "pending",
      }));
      setResults(resultsRef.current.slice());
      setTotal(prepared.length);

      // 3. POST each chunk (bounded concurrency). Each request processes its labels synchronously
      //    and returns the finished results inline, which we merge as each chunk resolves.
      let offset = 0;
      const descriptors = chunks.map((c) => {
        const d = { files: c, offset };
        offset += c.length;
        return d;
      });
      setPrep(`Analyzing ${prepared.length} label${prepared.length === 1 ? "" : "s"} in ${chunks.length} batch${chunks.length === 1 ? "" : "es"}…`);

      let anyOk = false;
      await mapPool(descriptors, CHUNK_CONCURRENCY, async (d) => {
        const fd = new FormData();
        for (const f of d.files) fd.append("images", f);
        fd.append("mode", mode);
        if (mode === "application") fd.append("applicationId", applicationId);
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
      setRunning(false);
      if (!anyOk) {
        setError("None of the batches could be analyzed. Please try again in a moment.");
      }
    } catch {
      setPrep(null);
      setRunning(false);
      setError("Something went wrong preparing the batch.");
    }
  }

  const doneCount = results.filter(
    (f) => f.status === "done" || f.status === "error",
  ).length;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
          Batch label review
        </h1>
        <p className="mt-2 text-lg text-neutral-600 dark:text-neutral-300">
          Upload many labels at once. We analyze them a few at a time and show
          per-file results as they finish.
        </p>
      </header>

      <form onSubmit={onSubmit} noValidate>
        <section aria-labelledby="b-step-1" className="mb-8">
          <h2 id="b-step-1" className="mb-3 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
            1. Add label photos
          </h2>
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-neutral-300 bg-neutral-50 p-8 text-center hover:bg-neutral-100 focus-within:ring-4 focus-within:ring-blue-500/40 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="sr-only"
              onChange={(e) => {
                setResults([]);
                setTotal(0);
                setError(null);
                setFiles(Array.from(e.target.files ?? []));
              }}
            />
            <span className="text-base font-medium text-neutral-800 dark:text-neutral-100">
              {files.length > 0
                ? `${files.length} file${files.length === 1 ? "" : "s"} selected — choose again to replace`
                : `Tap to choose photos (up to ${MAX_TOTAL_FILES})`}
            </span>
            <span className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              JPEG, PNG, or WebP · large photos are shrunk automatically before upload
            </span>
          </label>
        </section>

        <section aria-labelledby="b-step-2" className="mb-8">
          <h2 id="b-step-2" className="mb-3 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
            2. What to check against
          </h2>
          <fieldset className="space-y-3">
            <legend className="sr-only">Batch comparison mode</legend>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-300 p-3 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900">
              <input
                type="radio"
                name="bmode"
                checked={mode === "self"}
                onChange={() => setMode("self")}
                className="mt-1 h-4 w-4 accent-blue-700"
              />
              <span>
                <span className="block font-medium text-neutral-900 dark:text-neutral-100">
                  Check each label on its own
                </span>
                <span className="block text-sm text-neutral-500 dark:text-neutral-400">
                  Verify the government warning and alcohol format per label.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-300 p-3 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900">
              <input
                type="radio"
                name="bmode"
                checked={mode === "application"}
                onChange={() => setMode("application")}
                className="mt-1 h-4 w-4 accent-blue-700"
              />
              <span>
                <span className="block font-medium text-neutral-900 dark:text-neutral-100">
                  Match all against one application
                </span>
                <span className="block text-sm text-neutral-500 dark:text-neutral-400">
                  For a shipment of the same product.
                </span>
              </span>
            </label>
            {mode === "application" && (
              <div className="ml-8">
                <label htmlFor="b-app" className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                  Application
                </label>
                <select
                  id="b-app"
                  value={applicationId}
                  onChange={(e) => setApplicationId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-neutral-900 focus:border-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                >
                  {applications.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.brandName} — {a.classType} ({a.ttbId})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </fieldset>
        </section>

        <button
          type="submit"
          disabled={running || files.length === 0}
          className="w-full rounded-xl bg-blue-700 px-6 py-3.5 text-lg font-semibold text-white shadow-sm hover:bg-blue-800 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/50 disabled:cursor-not-allowed disabled:bg-neutral-400 dark:disabled:bg-neutral-700"
          aria-busy={running}
        >
          {running ? "Analyzing batch…" : "Run batch"}
        </button>
      </form>

      <div className="mt-10" aria-live="polite">
        {prep && (
          <p className="mb-4 text-sm font-medium text-neutral-600 dark:text-neutral-300">{prep}</p>
        )}

        {error && (
          <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-900 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200">
            <p className="font-semibold">We hit a problem</p>
            <p className="mt-1 text-sm">{error}</p>
          </div>
        )}

        {results.length > 0 && (
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
              {results.map((f) => (
                <BatchRow key={f.index} file={f} />
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}

function BatchRow({ file }: { file: BatchFileResult }) {
  const flagged = file.review
    ? file.review.summary.mismatch +
      file.review.summary.missing +
      file.review.summary.review
    : 0;

  return (
    <li className="rounded-lg border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-neutral-900 dark:text-neutral-100">
          {file.filename}
        </span>
        <BatchStatus file={file} />
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
              <span className="text-neutral-400">
                {" "}
                · {(file.timingMs / 1000).toFixed(1)}s
              </span>
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
        </>
      )}
    </li>
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
