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
 * Upper bound on files per batch. Sized to the serverless execution model, not an arbitrary
 * number. The batch route runs with `maxDuration = 60s`; a measured local sweep at
 * BATCH_CONCURRENCY=4 came out almost perfectly linear at ~1.19s of wall-time per label
 * (40 -> 46.9s, 56 -> 65.1s, 72 -> 84.9s), so total time crosses the 60s function ceiling at
 * ~50 labels. 40 leaves ~13s of headroom for cold start and upload; 56 was measured to blow
 * past 60s (on Vercel that batch would be killed mid-run). Stakeholders asked for 200-300 at
 * once; reaching that reliably needs the production path (a durable queue + Vercel KV job store
 * + a background worker that survives the HTTP response) rather than a larger constant here --
 * see the fire-and-forget NOTE on processJob below and the in-memory-state limitation in README.
 */
export const MAX_BATCH_FILES = 40;

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

export function createJob(
  inputs: BatchInput[],
  mode: "self" | "application",
  expected: ApplicationData | null,
  applicationId?: string,
): BatchJob {
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

  // Fire-and-forget processing; the client polls GET /api/batch/[id] for progress.
  // NOTE (serverless): on Vercel this needs the instance to stay warm or a
  // waitUntil wrapper — see STATE.md / SECURITY.md. Works as-is on a long-lived server.
  void processJob(job, inputs, expected);

  return job;
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
