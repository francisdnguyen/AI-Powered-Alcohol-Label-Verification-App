"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { BatchFileResult, BatchJob } from "@/lib/batch";
import { FieldResultCard } from "@/components/FieldResultCard";

interface AppSummary {
  id: string;
  ttbId: string;
  brandName: string;
  classType: string;
}

type BatchMode = "self" | "application";

export default function BatchPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [mode, setMode] = useState<BatchMode>("self");
  const [applications, setApplications] = useState<AppSummary[]>([]);
  const [applicationId, setApplicationId] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<BatchJob | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/api/applications")
      .then((r) => r.json())
      .then((d: { applications?: AppSummary[] }) => {
        setApplications(d.applications ?? []);
        if (d.applications?.[0]) setApplicationId(d.applications[0].id);
      })
      .catch(() => {});
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function poll(jobId: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/batch/${jobId}`);
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Lost track of the batch.");
          if (pollRef.current) clearInterval(pollRef.current);
          setRunning(false);
          return;
        }
        setJob(data as BatchJob);
        if ((data as BatchJob).done) {
          if (pollRef.current) clearInterval(pollRef.current);
          setRunning(false);
        }
      } catch {
        // transient; keep polling
      }
    }, 1200);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (files.length === 0) {
      setError("Add at least one label photo.");
      return;
    }
    setRunning(true);
    setError(null);
    setJob(null);

    const fd = new FormData();
    for (const f of files) fd.append("images", f);
    fd.append("mode", mode);
    if (mode === "application") fd.append("applicationId", applicationId);

    try {
      const res = await fetch("/api/batch", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not start the batch.");
        setRunning(false);
        return;
      }
      poll(data.jobId as string);
    } catch {
      setError("Could not reach the server.");
      setRunning(false);
    }
  }

  const doneCount = job
    ? job.files.filter((f) => f.status === "done" || f.status === "error").length
    : 0;

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
                setJob(null);
                setError(null);
                setFiles(Array.from(e.target.files ?? []));
              }}
            />
            <span className="text-base font-medium text-neutral-800 dark:text-neutral-100">
              {files.length > 0
                ? `${files.length} file${files.length === 1 ? "" : "s"} selected — choose again to replace`
                : "Tap to choose photos (up to 25)"}
            </span>
            <span className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              JPEG, PNG, or WebP · up to 8 MB each
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
        {error && (
          <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-900 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200">
            <p className="font-semibold">We hit a problem</p>
            <p className="mt-1 text-sm">{error}</p>
          </div>
        )}

        {job && (
          <section aria-labelledby="b-results">
            <div className="flex items-baseline justify-between">
              <h2 id="b-results" className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
                Results
              </h2>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                {doneCount} of {job.total} done
              </p>
            </div>
            <ul className="mt-4 space-y-3">
              {job.files.map((f) => (
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
  if (file.status === "processing") {
    return <span className="rounded-full bg-blue-700 px-3 py-1 text-sm font-semibold text-white">Analyzing…</span>;
  }
  return <span className="rounded-full bg-neutral-300 px-3 py-1 text-sm font-semibold text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200">Waiting</span>;
}
