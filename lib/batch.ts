import { normalizeImage } from "./image";
import { extractLabel } from "./anthropic";
import { reviewLabel, type ApplicationData, type ReviewResult } from "./matcher";

/**
 * Max simultaneous Claude vision calls during a batch run — a stability default so a
 * large upload never fans out into hundreds of concurrent API calls (rate limits,
 * latency). This is independent of the dollar budget cap in lib/budget.ts, which is
 * the actual spend control ($5).
 */
export const BATCH_CONCURRENCY = 4;

/**
 * Upper bound on files per *request*. This is the per-chunk cap, not the whole-batch cap:
 * to reach the stakeholders' 200-300 target the client splits a large upload into chunks and
 * POSTs each separately (see app/batch/page.tsx), because Vercel caps a request body at ~4.5MB
 * and a serverless function at `maxDuration = 60s`. A measured local sweep at BATCH_CONCURRENCY=4
 * was almost perfectly linear at ~1.19s of wall-time per label (40 -> 46.9s, 56 -> 65.1s,
 * 72 -> 84.9s), so ~50 labels in one request already crosses the 60s ceiling. 20 per chunk clears
 * in ~24s with comfortable headroom for cold start + upload, and keeps the total chunk count for a
 * 300-file batch under the per-IP rate limit (20 POSTs / 10 min). The whole-batch total (300) is
 * enforced client-side. Full durability across serverless instances still needs a shared job store
 * (Vercel KV / Postgres) -- see the waitUntil note on createJob and the README limitation.
 */
export const MAX_BATCH_FILES = 20;

export type BatchFileStatus = "pending" | "processing" | "done" | "error";

export interface BatchFileResult {
  index: number;
  filename: string;
  status: BatchFileStatus;
  overall?: "pass" | "attention";
  review?: ReviewResult;
  timingMs?: number;
  error?: string;
}

export interface BatchJob {
  id: string;
  createdAt: number;
  mode: "self" | "application";
  applicationId?: string;
  total: number;
  files: BatchFileResult[];
  done: boolean;
}

// In-memory job store. Prototype only: resets on process restart / serverless cold
// start. A production build would move this to a durable store (Vercel KV / Postgres).
const jobs = new Map<string, BatchJob>();

export function getJob(id: string): BatchJob | undefined {
  return jobs.get(id);
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
}

export interface CreatedJob {
  job: BatchJob;
  /**
   * The background processing promise. The route hands this to `waitUntil()` so Vercel keeps the
   * function alive until every label in the chunk is graded, instead of freezing it the instant
   * the HTTP response flushes. Resolves when the job is done (it never rejects; per-file errors are
   * captured on each file result).
   */
  processing: Promise<void>;
}

export function createJob(
  inputs: BatchInput[],
  mode: "self" | "application",
  expected: ApplicationData | null,
  applicationId?: string,
): CreatedJob {
  // Keep the store bounded: drop the oldest jobs beyond a small cap.
  if (jobs.size > 50) {
    const oldest = [...jobs.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
    if (oldest) jobs.delete(oldest.id);
  }

  const id = `batch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const job: BatchJob = {
    id,
    createdAt: Date.now(),
    mode,
    applicationId,
    total: inputs.length,
    files: inputs.map((input, index) => ({
      index,
      filename: input.filename,
      status: "pending",
    })),
    done: false,
  };
  jobs.set(id, job);

  // Kick off processing and hand the promise back so the route can wrap it in waitUntil().
  // The client polls GET /api/batch/[id] for progress. On a long-lived server this runs to
  // completion on its own; on Vercel, waitUntil() is what keeps the function from freezing the
  // instant the response flushes. Cross-instance durability still needs a shared store (KV).
  const processing = processJob(job, inputs, expected);

  return { job, processing };
}

async function processJob(
  job: BatchJob,
  inputs: BatchInput[],
  expected: ApplicationData | null,
): Promise<void> {
  await runPool(inputs, BATCH_CONCURRENCY, async (input, index) => {
    const fileResult = job.files[index];
    fileResult.status = "processing";
    const started = Date.now();
    try {
      const normalized = await normalizeImage(input.buffer);
      const extracted = await extractLabel(normalized);
      const review = reviewLabel(extracted, expected);
      fileResult.review = review;
      fileResult.overall = review.overall;
      fileResult.timingMs = Date.now() - started;
      fileResult.status = "done";
    } catch (err) {
      fileResult.status = "error";
      fileResult.error =
        err instanceof Error ? err.message : "Could not analyze this label.";
      fileResult.timingMs = Date.now() - started;
    }
  });
  job.done = true;
}
