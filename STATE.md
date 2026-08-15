# STATE.md — durable invariant map

> The project's stable memory. Update at each phase transition and after every file
> modification. Truth has one home. (See AGENTS.md.)

## What this is
Prototype for TTB compliance agents: extract 7 fields from an alcohol-label photo and grade
them against submitted application data, flagging mismatches for human review.

## Current phase
**Deployed & live-verified, now reframed as a review-queue console.** All steps 0–7 complete; live
Claude calls verified locally and on Vercel. Single-label review ~3–4s.

**UI redesign (queue console):** home (`app/page.tsx`) is now a worklist of 12 mock COLA
applications (stat tiles, status tabs, search, priority) → `/review/[id]` shows the filing + label
side-by-side, "Run AI verification" (POSTs the app's label to `/api/review`), a 3-tier
recommendation (`recommendationFor` in `lib/matcher.ts`), and a disposition saved to localStorage
(`lib/dispositions.ts`). The old upload flow moved to `/custom`; `/batch` unchanged. Each app has a
generated label image (`scripts/make-sample-labels.mjs`, 12 labels, a few with intentional
divergences). Verified end-to-end in-browser: queue → open → verify (caught the Costa Verde ABV
mismatch → "Likely rejection") → reject → queue shows Actioned 1 / Rejected 1.

**Batch upgraded (post-deploy):** raised to a 200–300-file capability via browser-side downscaling
(`lib/imageClient.ts`) + client chunking into ≤20-file, <4.5 MB requests, merged into one progress
bar. Each chunk is analyzed **synchronously inside its POST** (results returned inline; no job store,
no polling). An earlier async-job + poll design was proven **broken on Vercel** — the in-memory job
Map is per-instance, so a poll load-balanced away from the creating instance 404'd (confirmed live).
The synchronous rewrite fixes it. Verified: local 3-chunk run all `done` inline, AND prod re-test
(3-file chunk on Vercel returned results inline, HTTP 200, no 404).

**Matching + image upgrades (from a peer-code comparison):**
- `lib/matcher.ts` — added corporate-suffix truncation (`Sierra Nevada` == `Sierra Nevada Brewing
  Co.`, but `Reserve` still reviews), attribution-prefix stripping for the bottler address
  (`Distilled & Bottled by X` == `X`), and Levenshtein single-char OCR-misread → review. 37 unit
  tests (was 29).
- `lib/image.ts` — `normalizeImage` → `prepareImages` returning `NormalizedImage[]`: upscales tiny
  images, splits very large ones (long edge > ~2352px) into two overlapping tiles along the longer
  axis. `extractLabel` now takes an array and sends N image blocks as "sections of the same label".
  Verified live: a 2000×3000 image tiled into 2, all 7 fields extracted at high confidence.

**Full console (bulk verify + persisted verdicts):**
- **Bulk verify from the queue.** Rows are multi-selectable (per-row + select-all-visible
  checkboxes); "Verify selected" fetches each label client-side, downscales it, and POSTs to
  `/api/batch` in a new `mode:"queue"` where each image is paired with its OWN application via a
  parallel `applicationIds[]` field — so N different filings are graded correctly in one request
  (not all against one app). `lib/batch.ts` `processBatch` now takes a per-input `expected` override;
  `BatchFileResult` echoes `applicationId`. The queue caps a request at `MAX_BATCH_FILES` and chunks
  if the seed list ever exceeds it (12 apps today → one request). Verified live: selecting Silver
  Creek + Costa Verde → one `/api/batch` 200 → "Verified 2 labels — 1 ready, 1 likely rejection",
  each graded against its own filing (Costa Verde's ABV mismatch → reject).
- **Persisted AI verdicts.** `lib/verdicts.ts` (localStorage, sibling to `dispositions.ts`) stores
  the last recommendation + full field review per application. Reopening a review restores the saved
  result (banner + field cards + "Last verified …") **without re-running** the model. A verdict is
  advisory only — it never sets a disposition; a human still records the decision. Verified live:
  reopening a verified item showed the restored result and fired **no** `/api/review` call.
  (An earlier "AI check" queue column and a visual match board surfaced these verdicts too; both were
  **removed by owner decision** — the column showed mostly "Not run" and added little, and neither
  peer console had a board. Verdict persistence + the bulk-verify path stay.)
- **Bulk-verify helper.** `lib/bulkVerify.ts` holds the client verify path (fetch label → downscale
  → chunk → POST `/api/batch` queue mode → persist verdict) used by the queue's "Verify selected".
  Bulk-run verdicts surface by making each application's review page restore instantly instead of
  re-running the model.

## Architecture invariants (do not violate without updating this file)
1. **Claude transcribes only; it never decides match/mismatch.** Extraction returns raw field
   values + per-field confidence + found/not-found. All grading is deterministic code in
   `lib/matcher.ts`. Blast radius of an adversarial label photo = at most one corrupted
   transcribed value, never a flipped verdict.
2. **`ANTHROPIC_API_KEY` is server-only.** Never imported into any client component or bundled
   to the browser. Lives behind `/api/*` route handlers.
3. **The browser is untrusted.** Every `/api/*` route validates input — a MIME allowlist + size cap
   on uploads and free-text length caps (manual guards in the route handlers). Zod validates the
   model's *output* (`extractedLabelSchema`), not the multipart form input.
4. **State lives in-memory** (`Map`) for the prototype — mock applications and rate-limit counters
   reset on process restart / serverless cold start. Documented limitation, not a bug. Full
   durability = a shared store (Vercel KV / Postgres). (Note: batch has **no** job store anymore —
   see 4a.)
4a. **Batch = client-chunked + synchronous.** `MAX_BATCH_FILES` (20) is the PER-REQUEST cap; the
   browser splits a large upload into chunks, POSTs each, and merges results. Each chunk is analyzed
   synchronously inside its POST and returns results inline — no job store, no polling. This replaced
   an async-job + poll design that 404'd on Vercel (per-instance job Map). Whole-batch total (300) is
   enforced client-side; per-chunk sizing is bounded by the ~4.5 MB body limit and the measured
   ~1.19s/label throughput under the 60s function limit. `/api/batch` has three modes: `self`
   (each label on its own), `application` (all files vs one filing), and `queue` (each file paired
   with its own `applicationId` — the queue's bulk verify). All three run through the same
   synchronous chunk path.
5. **Government warning is matched verbatim** (strict); other fields tolerant-normalized. A
   photo cannot verify **bold** formatting — known, documented limit.
6. **Latency budget ~5s**, dominated by the single Haiku vision call. Measured and surfaced,
   not asserted.
7. **Claude spend is controlled at the account level** (Anthropic Console usage limits), NOT in
   code. The earlier in-app `$5` cap (`lib/budget.ts`, `/api/budget`, HTTP 402) was **removed by
   owner decision** — an in-memory counter can't be shared across serverless instances, and the
   account-level limit is the reliable ceiling. `ANALYSIS_BUDGET_USD` is no longer read by any code.

## Toolchain / stack (pinned)
- Runtime: Node 22.19.0. Package manager: **pnpm 11.20.0** via corepack (no global shim;
  invoke as `corepack pnpm@11.20.0 ...`).
- Framework: Next.js **16.3.0** (App Router) + React 19.2.8 + TypeScript **5.9.3**
  (chose proven TS 5.9.3 over the new TS 7 native compiler for reliability).
- AI: `@anthropic-ai/sdk` **0.115.0**, Claude Haiku 4.5 vision.
- Validation: zod 4.4.3. Image: sharp 0.35.3. Tests: vitest 4.1.10. Styling: tailwindcss 4.3.3.
- All deps pinned to EXACT versions (`save-exact=true`). Supply-chain gate:
  `minimumReleaseAge: 10080` (7 days) + `minimumReleaseAgeStrict: true` in
  `pnpm-workspace.yaml`. Two packages were downgraded to pass the gate:
  `@anthropic-ai/sdk` 0.116.0→0.115.0, and eslint pinned to 9.39.5 (eslint-config-next@16 peers
  to eslint 9, not 10).

## Key files
- Config: `package.json`, `.npmrc`, `pnpm-workspace.yaml`, `tsconfig.json`, `next.config.ts`
  (security headers + CSP), `postcss.config.mjs`, `eslint.config.mjs`, `.env.example`.
- Lib: `lib/anthropic.ts` (Claude vision transcription), `lib/matcher.ts` (grading +
  `recommendationFor`; `+ matcher.test.ts`), `lib/image.ts` (server prep/tiling),
  `lib/imageClient.ts` (browser downscale + chunk), `lib/batch.ts`, `lib/rateLimit.ts`,
  `lib/applications.ts` (12 mock COLA apps + queue metadata; `listApplications` now includes
  `labelImage` so the queue can bulk-verify), `lib/dispositions.ts` (localStorage human decisions;
  `+ dispositions.test.ts`), `lib/verdicts.ts` (localStorage persisted AI recommendations;
  `+ verdicts.test.ts`), `lib/ttb.ts`, `lib/schema.ts`.
- App: `app/page.tsx` (**review queue** console), `app/review/[id]/page.tsx` (+ `ReviewClient.tsx`,
  the per-application review + verify + disposition), `app/custom/page.tsx` (ad-hoc upload check),
  `app/batch/page.tsx`, `app/layout.tsx` (nav), `app/globals.css`, API routes
  `app/api/{review,extract,batch,applications}/route.ts`, `components/FieldResultCard.tsx`,
  `components/icons.tsx` (dependency-free inline SVGs for the stat-tile/priority/search glyphs).
  Client verify path shared in `lib/bulkVerify.ts`. The queue table adds **#** and **Applicant**
  (producer) columns and color-coded Type pills / status + priority glyphs; `listApplications` now
  also returns `producerNameAddress`.
- Docs: `README.md`, `SECURITY.md`, `ROADMAP.md`, this file.

## Open threads
- `next-env.d.ts` references `.next/types`, so the real typecheck gate is `next build`, not
  bare `tsc --noEmit` on a clean tree.
- Rate limiter + mock-app state are in-memory (per-instance on serverless) — durable store is the
  documented production follow-up.
