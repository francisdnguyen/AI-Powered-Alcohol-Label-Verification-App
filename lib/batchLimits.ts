/**
 * Shared batch/chunk limits — the single source of truth for the per-request file cap.
 *
 * Client-safe by design: this module imports nothing server-only (no `sharp`, no Anthropic SDK), so
 * both the server route (via `lib/batch`) and the browser-side chunkers (`lib/bulkVerify`,
 * `app/batch/page.tsx`) can import it without dragging server code into the client bundle
 * (STATE.md invariant 2). Because the client's per-chunk count is *derived* from `MAX_BATCH_FILES`,
 * the two can't drift apart — a client chunk larger than the server cap would 400.
 *
 * Why 20 per request: a measured local sweep at BATCH_CONCURRENCY=4 was almost perfectly linear at
 * ~1.19s wall-time per label (40→46.9s, 56→65.1s, 72→84.9s), so ~50 labels in one request already
 * crosses Vercel's 60s function ceiling. 20 per chunk clears in ~24s with headroom for cold start +
 * upload, and keeps the chunk count for a 300-file batch under the per-IP rate limit (20 POSTs/10min).
 */

/** Upper bound on files per *request* (the per-chunk cap, not the whole-batch cap). */
export const MAX_BATCH_FILES = 20;

/** Per-chunk byte budget — kept under Vercel's ~4.5 MB request-body limit with margin. */
export const CHUNK_MAX_BYTES = 3.6 * 1024 * 1024;

/** Per-chunk file count the browser splits on — derived so it can never drift from the server cap. */
export const CHUNK_MAX_COUNT = MAX_BATCH_FILES;
