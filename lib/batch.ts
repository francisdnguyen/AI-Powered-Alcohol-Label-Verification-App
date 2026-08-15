import { prepareImages } from "./image";
import { extractLabel } from "./anthropic";
import { reviewLabel, type ApplicationData, type ReviewResult } from "./matcher";

/**
 * Max simultaneous Claude vision calls while processing one chunk — a stability default so a
 * chunk never fans out into dozens of concurrent API calls (rate limits, latency).
 */
export const BATCH_CONCURRENCY = 4;

/**
 * Upper bound on files per *request* — the per-chunk cap, not the whole-batch cap. To reach the
 * stakeholders' 200-300 target the client splits a large upload into chunks and POSTs each
 * separately (see app/batch/page.tsx), because Vercel caps a request body at ~4.5MB and a
 * serverless function at `maxDuration = 60s`. Each chunk is processed SYNCHRONOUSLY inside its own
 * POST and the finished results are returned in the response body — no job store, no polling (an
 * earlier async-job + poll design 404'd on Vercel, where the in-memory job Map is per-instance).
 *
 * The value lives in `./batchLimits` (client-safe) so the browser chunkers derive their per-chunk
 * count from the same number and can't drift out of agreement with this cap. Re-exported here so
 * server callers keep importing it from `lib/batch`.
 */
export { MAX_BATCH_FILES } from "./batchLimits";

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
