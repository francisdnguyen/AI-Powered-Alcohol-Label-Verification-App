import { prepareImages } from "./image";
import { extractLabel } from "./anthropic";
import { reviewLabel, type ApplicationData, type ReviewResult } from "./matcher";

/**
 * Max simultaneous Claude vision calls while processing one chunk — a stability default so a
 * chunk never fans out into dozens of concurrent API calls (rate limits, latency).
 */
export const BATCH_CONCURRENCY = 4;

/**
 * Upper bound on files per *request*. This is the per-chunk cap, not the whole-batch cap: to reach
 * the stakeholders' 200-300 target the client splits a large upload into chunks and POSTs each
 * separately (see app/batch/page.tsx), because Vercel caps a request body at ~4.5MB and a
 * serverless function at `maxDuration = 60s`.
 *
 * Each chunk is processed SYNCHRONOUSLY inside its own POST and the finished results are returned
 * in the response body -- there is no job store and no polling. That is deliberate: an earlier
 * async-job + poll design was proven broken on Vercel, where the in-memory job Map is per-instance,
 * so a poll load-balanced to a different instance than the POST got a 404. Synchronous chunks sit
 * entirely inside one function invocation, so they sidestep the cross-instance problem.
 *
 * A measured local sweep at BATCH_CONCURRENCY=4 was almost perfectly linear at ~1.19s of wall-time
 * per label (40 -> 46.9s, 56 -> 65.1s, 72 -> 84.9s), so ~50 labels in one request already crosses
 * the 60s ceiling. 20 per chunk clears in ~24s with comfortable headroom for cold start + upload,
 * and keeps the chunk count for a 300-file batch under the per-IP rate limit (20 POSTs / 10 min).
 * The whole-batch total (300) is enforced client-side.
 */
export const MAX_BATCH_FILES = 20;

export type BatchFileStatus = "pending" | "done" | "error";

export interface BatchFileResult {
  index: number;
  filename: string;
  status: BatchFileStatus;
  overall?: "pass" | "attention";
  review?: ReviewResult;
  timingMs?: number;
  error?: string;
  /** Echoed back in queue mode so the client can persist the verdict against the right application. */
  applicationId?: string;
}

/** Run `worker` over items with at most `limit` in flight at once. */
export async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++;
        await worker(items[index], index);
      }
    },
  );
  await Promise.all(runners);
}

export interface BatchInput {
  buffer: Buffer;
  filename: string;
  /**
   * The application to grade this label against: `null` for a self-check, one application for
   * `application` mode (same value on every input), or this file's own application in `queue` mode
   * (a different value per input). The caller sets it per file; that is what lets queue mode grade
   * many labels each against their own filing rather than all against one.
   */
  expected: ApplicationData | null;
  /** Echoed onto the result so the client can map a verdict back to its application. */
  applicationId?: string;
}

/**
 * Process one chunk of labels and return a per-file result for each. Never rejects: a failure on
 * one label (bad image, Claude error) is captured as that file's
 * `error` result so the rest of the chunk still comes back.
 */
export async function processBatch(inputs: BatchInput[]): Promise<BatchFileResult[]> {
  const results: BatchFileResult[] = inputs.map((input, index) => ({
    index,
    filename: input.filename,
    status: "pending",
    applicationId: input.applicationId,
  }));

  await runPool(inputs, BATCH_CONCURRENCY, async (input, index) => {
    const started = Date.now();
    try {
      const normalized = await prepareImages(input.buffer);
      const extracted = await extractLabel(normalized);
      const review = reviewLabel(extracted, input.expected);
      results[index] = {
        index,
        filename: input.filename,
        status: "done",
        review,
        overall: review.overall,
        timingMs: Date.now() - started,
        applicationId: input.applicationId,
      };
    } catch (err) {
      results[index] = {
        index,
        filename: input.filename,
        status: "error",
        error: err instanceof Error ? err.message : "Could not analyze this label.",
        timingMs: Date.now() - started,
        applicationId: input.applicationId,
      };
    }
  });

  return results;
}
