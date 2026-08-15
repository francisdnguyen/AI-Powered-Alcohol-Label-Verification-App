/**
 * Client-side bulk verification, used by the review queue's "Verify selected". Given a set of
 * applications (id + label image path) it fetches each label, downscales it, and POSTs to
 * `/api/batch` in `mode:"queue"` — where each image is paired with its OWN application id — so N
 * different filings are each graded against their own application in as few requests as the
 * per-chunk caps allow. Every finished verdict is persisted via `setVerdict`, which is what lets a
 * reopened review restore without re-running (and re-spending on) the model.
 *
 * The browser is the only place that can read the seeded `/labels/*` images without touching the
 * serverless filesystem (which isn't reliable on Vercel), so the fetch happens here, not on the API.
 */

import { downscaleImage } from "./imageClient";
import { recommendationFor } from "./matcher";
import { setVerdict } from "./verdicts";
import type { BatchFileResult } from "./batch";

/** Per-chunk byte budget (under Vercel's ~4.5 MB body limit) and count cap (matches MAX_BATCH_FILES). */
const CHUNK_MAX_BYTES = 3.6 * 1024 * 1024;
const CHUNK_MAX_COUNT = 20;

export interface VerifyTarget {
  id: string;
  labelImage: string;
}

export interface BulkVerifySummary {
  /** Counts by recommendation level for the labels that verified cleanly. */
  approve: number;
  review: number;
  reject: number;
  /** Labels the model judged too low-quality to verify. */
  image: number;
  /** Labels that couldn't be fetched or analyzed. */
  failed: number;
  /** True if the run was cancelled (via AbortSignal) before every target was processed. */
  cancelled: boolean;
  /** First distinct server/transport error, for surfacing a message. */
  error?: string;
}

type Pair = { file: File; id: string };

/** Split label/app pairs into request-sized chunks under both a byte budget and a count cap. */
function chunkPairs(pairs: Pair[], maxBytes: number, maxCount: number): Pair[][] {
  const chunks: Pair[][] = [];
  let current: Pair[] = [];
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

/** Did this rejection come from an aborted fetch (caller cancelled the run)? */
function isAbort(e: unknown): boolean {
  return (e as { name?: string })?.name === "AbortError";
}

/**
 * Verify a set of applications against their own filings. Never throws — failures are counted into
 * the returned summary. Each persisted verdict fires `VERDICTS_CHANGED_EVENT`, so a caller showing
 * per-row pills refreshes them as verdicts land (one burst per resolved chunk).
 *
 * Pass an `AbortSignal` to make the run cancellable: it's checked before each label fetch and before
 * each chunk, and forwarded to both fetches. Cancel is client-side only — an in-flight chunk's server
 * work may still finish, but its result is discarded (`fetch` rejects, so no verdict is persisted for
 * it). On cancel the summary keeps whatever verdicts already landed and sets `cancelled = true`; an
 * aborted request is never counted as `failed`.
 */
export async function bulkVerify(
  targets: VerifyTarget[],
  signal?: AbortSignal,
): Promise<BulkVerifySummary> {
  const summary: BulkVerifySummary = {
    approve: 0,
    review: 0,
    reject: 0,
    image: 0,
    failed: 0,
    cancelled: false,
  };

  // 1. Fetch + downscale each label into a File paired with its application id.
  const pairs: Pair[] = [];
  for (const t of targets) {
    if (signal?.aborted) {
      summary.cancelled = true;
      return summary;
    }
    try {
      const res = await fetch(t.labelImage, { signal });
      if (!res.ok) {
        summary.failed++;
        continue;
      }
      const blob = await res.blob();
      const raw = new File([blob], t.labelImage.split("/").pop() ?? `${t.id}.png`, {
        type: blob.type || "image/png",
      });
      pairs.push({ file: await downscaleImage(raw), id: t.id });
    } catch (e) {
      if (isAbort(e)) {
        summary.cancelled = true;
        return summary;
      }
      summary.failed++;
    }
  }

  // 2. POST request-sized chunks; persist each finished verdict as it returns.
  for (const chunk of chunkPairs(pairs, CHUNK_MAX_BYTES, CHUNK_MAX_COUNT)) {
    if (signal?.aborted) {
      summary.cancelled = true;
      break;
    }
    const fd = new FormData();
    for (const p of chunk) {
      fd.append("images", p.file);
      fd.append("applicationIds", p.id);
    }
    fd.append("mode", "queue");
    try {
      const res = await fetch("/api/batch", { method: "POST", body: fd, signal });
      const data = await res.json();
      if (!res.ok || !Array.isArray(data.files)) {
        summary.failed += chunk.length;
        summary.error ??= data?.error || `Verification failed (${res.status}).`;
        continue;
      }
      for (const f of data.files as BatchFileResult[]) {
        if (f.status === "done" && f.review && f.applicationId) {
          const recommendation = recommendationFor(f.review);
          setVerdict(f.applicationId, {
            recommendation,
            review: f.review,
            verifiedAt: Date.now(),
            totalMs: f.timingMs,
          });
          summary[recommendation.level]++;
        } else {
          summary.failed++;
        }
      }
    } catch (e) {
      // A cancelled in-flight chunk rejects here; discard its (possibly still-running) server work
      // rather than counting it as a failure.
      if (isAbort(e)) {
        summary.cancelled = true;
        break;
      }
      summary.failed += chunk.length;
      summary.error ??= "Could not reach the server while verifying.";
    }
  }

  return summary;
}

/** Human-readable roll-up of a bulk run, e.g. "Verified 8 labels — 5 ready, 2 need review; 1 failed". */
export function summarize(summary: BulkVerifySummary): string {
  const ok = summary.approve + summary.review + summary.reject + summary.image;
  const parts: string[] = [];
  if (summary.approve) parts.push(`${summary.approve} ready`);
  if (summary.review) parts.push(`${summary.review} need review`);
  if (summary.reject) parts.push(`${summary.reject} likely rejection`);
  if (summary.image) parts.push(`${summary.image} need a clearer photo`);

  if (summary.cancelled) {
    // Cancelled mid-run: lead with the stop, but still credit any verdicts that already landed.
    if (ok === 0) return "Verification cancelled.";
    let msg = `Cancelled — verified ${ok} label${ok === 1 ? "" : "s"} first`;
    if (parts.length) msg += ` (${parts.join(", ")})`;
    return msg;
  }

  let msg = ok > 0 ? `Verified ${ok} label${ok === 1 ? "" : "s"}` : "";
  if (parts.length) msg += ` — ${parts.join(", ")}`;
  if (summary.failed > 0) msg += `${ok > 0 ? "; " : ""}${summary.failed} could not be checked`;
  return msg;
}
