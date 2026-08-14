"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ReviewMode, ReviewResponse } from "@/lib/matcher";
import { downscaleImage } from "@/lib/imageClient";
import { FieldResultCard } from "@/components/FieldResultCard";
import type { ApplicationSummary } from "@/lib/applications";

const MANUAL_FIELDS = [
  { key: "brandName", label: "Brand name" },
  { key: "classType", label: "Class / type designation" },
  { key: "alcoholContent", label: "Alcohol content" },
  { key: "netContents", label: "Net contents" },
  { key: "producerNameAddress", label: "Producer name & address" },
  { key: "countryOfOrigin", label: "Country of origin" },
] as const;

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [mode, setMode] = useState<ReviewMode>("application");
  const [applications, setApplications] = useState<ApplicationSummary[]>([]);
  const [applicationId, setApplicationId] = useState("");
  const [manual, setManual] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReviewResponse | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/applications")
      .then((r) => r.json())
      .then((d: { applications?: ApplicationSummary[] }) => {
        setApplications(d.applications ?? []);
        if (d.applications?.[0]) setApplicationId(d.applications[0].id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (result || error) resultsRef.current?.focus();
  }, [result, error]);

  function chooseFile(f: File | null) {
    setResult(null);
    setError(null);
    if (f && !f.type.startsWith("image/")) {
      setError("Please choose an image file (JPEG, PNG, or WebP).");
      setFile(null);
      return;
    }
    setFile(f);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Please add a label photo first.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);

    // Shrink large photos in the browser so a multi-MB phone image doesn't hit Vercel's ~4.5 MB
    // request-body limit before the server's 8 MB check. Small images pass through untouched, and
    // downscaleImage never throws (falls back to the original on any failure).
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
      if (!res.ok) {
        setError(data.error || "Something went wrong while analyzing the label.");
      } else {
        setResult(data as ReviewResponse);
      }
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  const seconds = result ? (result.timing.totalMs / 1000).toFixed(1) : null;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
          Custom label check
        </h1>
        <p className="mt-2 text-lg text-neutral-600 dark:text-neutral-300">
          An ad-hoc check outside the queue: upload any label photo and verify it against an
          application, your own values, or just the label&apos;s own requirements. We read the seven
          required fields and flag anything that doesn&apos;t match.
        </p>
      </header>

      <form onSubmit={onSubmit} noValidate>
        {/* Step 1: upload */}
        <section aria-labelledby="step-1" className="mb-8">
          <h2 id="step-1" className="mb-3 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
            1. Add the label photo
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
              chooseFile(e.dataTransfer.files?.[0] ?? null);
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
              className="sr-only"
              onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
            />
            <span className="text-base font-medium text-neutral-800 dark:text-neutral-100">
              {file ? "Choose a different photo" : "Tap to choose a photo, or drag one here"}
            </span>
            <span className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              JPEG, PNG, or WebP · up to 8 MB
            </span>
          </label>

          {previewUrl && (
            <div className="mt-4 flex items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl}
                alt="Preview of the label you uploaded"
                className="h-24 w-24 rounded-lg border border-black/10 object-cover dark:border-white/10"
              />
              <div className="text-sm text-neutral-600 dark:text-neutral-300">
                <p className="font-medium text-neutral-900 dark:text-neutral-100">
                  {file?.name}
                </p>
                <button
                  type="button"
                  onClick={() => chooseFile(null)}
                  className="mt-1 rounded text-blue-700 underline underline-offset-2 hover:text-blue-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-400"
                >
                  Remove
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Step 2: what to check against */}
        <section aria-labelledby="step-2" className="mb-8">
          <h2 id="step-2" className="mb-3 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
            2. Check it against&hellip;
          </h2>

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
              <div className="ml-8">
                <label
                  htmlFor="application"
                  className="block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                >
                  Application
                </label>
                <select
                  id="application"
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

            <ModeRadio
              value="manual"
              checked={mode === "manual"}
              onChange={() => setMode("manual")}
              title="Values I type in"
              desc="Enter the expected values by hand."
            />
            {mode === "manual" && (
              <div className="ml-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {MANUAL_FIELDS.map((f) => (
                  <div key={f.key}>
                    <label
                      htmlFor={f.key}
                      className="block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                    >
                      {f.label}
                    </label>
                    <input
                      id={f.key}
                      type="text"
                      maxLength={300}
                      value={manual[f.key] ?? ""}
                      onChange={(e) =>
                        setManual((m) => ({ ...m, [f.key]: e.target.value }))
                      }
                      className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-neutral-900 focus:border-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                    />
                  </div>
                ))}
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
        </section>

        <button
          type="submit"
          disabled={loading || !file}
          className="w-full rounded-xl bg-blue-700 px-6 py-3.5 text-lg font-semibold text-white shadow-sm transition-colors hover:bg-blue-800 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/50 disabled:cursor-not-allowed disabled:bg-neutral-400 dark:disabled:bg-neutral-700"
          aria-busy={loading}
        >
          {loading ? "Analyzing the label…" : "Analyze label"}
        </button>
      </form>

      {/* Results / errors */}
      <div ref={resultsRef} tabIndex={-1} className="mt-10 scroll-mt-4 focus:outline-none">
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
          <section aria-labelledby="results-heading" aria-live="polite">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="results-heading" className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
                Review results
              </h2>
              {seconds && (
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  Analyzed in {seconds}s
                </p>
              )}
            </div>

            <OverallBanner result={result} />

            <ul className="mt-4 space-y-3">
              {result.review.fields.map((f) => (
                <FieldResultCard key={f.key} field={f} />
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}

function ModeRadio({
  value,
  checked,
  onChange,
  title,
  desc,
}: {
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
        name="mode"
        value={value}
        checked={checked}
        onChange={onChange}
        className="mt-1 h-4 w-4 accent-blue-700 focus-visible:ring-2 focus-visible:ring-blue-500"
      />
      <span>
        <span className="block font-medium text-neutral-900 dark:text-neutral-100">
          {title}
        </span>
        <span className="block text-sm text-neutral-500 dark:text-neutral-400">
          {desc}
        </span>
      </span>
    </label>
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
