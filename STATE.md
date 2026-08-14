# STATE.md — durable invariant map

> The project's stable memory. Update at each phase transition and after every file
> modification. Truth has one home. (See AGENTS.md.)

## What this is
Prototype for TTB compliance agents: extract 7 fields from an alcohol-label photo and grade
them against submitted application data, flagging mismatches for human review.

## Current phase
**Deployed & live-verified.** All steps 0–7 complete; live Claude calls verified locally and on
Vercel (https://ai-powered-alcohol-label-verificati-ochre.vercel.app). Single-label review ~3–4s;
extraction + deterministic grading confirmed against the sample labels. README latency section
holds measured numbers.

**Batch upgraded (post-deploy):** raised to a 200–300-file capability via browser-side downscaling
(`lib/imageClient.ts`) + client chunking into ≤20-file, <4.5 MB requests, merged into one progress
bar; each chunk kept alive past the response with `waitUntil()` (`@vercel/functions`). Verified
end-to-end locally: 25 files → 2 chunks (20+5) → 25/25 done in ~24s, 0 errors.

## Architecture invariants (do not violate without updating this file)
1. **Claude transcribes only; it never decides match/mismatch.** Extraction returns raw field
   values + per-field confidence + found/not-found. All grading is deterministic code in
   `lib/matcher.ts`. Blast radius of an adversarial label photo = at most one corrupted
   transcribed value, never a flipped verdict.
2. **`ANTHROPIC_API_KEY` is server-only.** Never imported into any client component or bundled
   to the browser. Lives behind `/api/*` route handlers.
3. **The browser is untrusted.** Every `/api/*` route validates input with Zod, enforces a MIME
   allowlist + size cap on uploads, and caps free-text length.
4. **State lives in-memory** (`Map`) for the prototype — mock applications and batch jobs reset
   on process restart / serverless cold start. Documented limitation, not a bug. Batch chunks now
   survive the HTTP response via `waitUntil()`, but the job store is still per-instance, so a poll
   can miss a job on a recycled instance (UI gives up after ~15 misses and flags those files).
   Full durability = a shared store (Vercel KV / Postgres).
4a. **Batch = client-chunked.** `MAX_BATCH_FILES` (20) is the PER-REQUEST cap; the browser splits a
   large upload into chunks and merges results. Whole-batch total (300) is enforced client-side.
   Per-chunk sizing is bounded by the ~4.5 MB body limit and the measured ~1.19s/label throughput
   under the 60s function limit.
5. **Government warning is matched verbatim** (strict); other fields tolerant-normalized. A
   photo cannot verify **bold** formatting — known, documented limit.
6. **Latency budget ~5s**, dominated by the single Haiku vision call. Measured and surfaced,
   not asserted.
7. **Hard $5 spend cap on Claude usage** (`lib/budget.ts`, `ANALYSIS_BUDGET_USD`, default 5).
   Every Claude call goes through `extractLabel`, which asserts budget before the call and
   records exact cost from reported token usage (Haiku 4.5: $1/MTok in, $5/MTok out) after.
   Exhaustion → HTTP 402. **This is the user's "limit to 5" instruction — DOLLARS, not
   concurrency.** In-memory counter → per-instance on serverless, resets on restart (limitation).

## Toolchain / stack (pinned)
- Runtime: Node 22.19.0. Package manager: **pnpm 11.20.0** via corepack (no global shim;
  invoke as `corepack pnpm@11.20.0 ...`).
- Framework: Next.js **16.3.0** (App Router) + React 19.2.8 + TypeScript **5.9.3**
  (chose proven TS 5.9.3 over the new TS 7 native compiler for reliability).
- AI: `@anthropic-ai/sdk` **0.115.0**, Claude Haiku 4.5 vision.
- Serverless helpers: `@vercel/functions` **3.8.0** (`waitUntil` for batch chunk survival; pinned
  to 3.8.0 because 3.9.x was <7 days old and failed the freshness gate).
- Validation: zod 4.4.3. Image: sharp 0.35.3. Tests: vitest 4.1.10. Styling: tailwindcss 4.3.3.
- All deps pinned to EXACT versions (`save-exact=true`). Supply-chain gate:
  `minimumReleaseAge: 10080` (7 days) + `minimumReleaseAgeStrict: true` in
  `pnpm-workspace.yaml`. Two packages were downgraded to pass the gate:
  `@anthropic-ai/sdk` 0.116.0→0.115.0, and eslint pinned to 9.39.5 (eslint-config-next@16 peers
  to eslint 9, not 10).

## Key files (as they land)
- Config: `package.json`, `.npmrc`, `pnpm-workspace.yaml`, `tsconfig.json`, `next.config.ts`,
  `postcss.config.mjs`, `eslint.config.mjs`, `.env.example`.
- App: `app/layout.tsx`, `app/page.tsx`, `app/globals.css` (scaffold defaults, to be replaced).
- Not yet created: `lib/*`, `app/api/*`, `components/*`, tests, `SECURITY.md`, `README.md`.

## Open threads
- Canonical TTB government-warning text to hard-code in `lib/ttb.ts` — confirm with user (Step 1).
- Exact Claude Haiku 4.5 model id to use in the SDK call — verify at Step 1.
- Batch API concurrency capped at **5** per user instruction (Step 4) — flag before building.
- `next-env.d.ts` references `.next/types`, so the real typecheck gate is `next build`, not
  bare `tsc --noEmit` on a clean tree.
