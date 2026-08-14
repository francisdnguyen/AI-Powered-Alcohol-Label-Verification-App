# ROADMAP.md

Incremental build of the TTB label-verification prototype. Rule: do one step, verify it,
checkpoint with the user, then continue. Each step is independently runnable.

Legend: ☐ not started · ◐ in progress · ☑ done

## Step 0 — Scaffold + guardrails  ☑
Next.js 16 App Router scaffold, exact-pinned deps, pnpm freshness gate, `.env.example`,
`STATE.md`, `ROADMAP.md`. Verified: `next build` green (TS passed), `next start` serves HTTP 200.

## Step 1 — Extraction core  ◐
`lib/schema.ts` (Zod, 7 fields + confidence/found), `lib/ttb.ts` (canonical warning),
`lib/image.ts` (sharp normalize), `lib/anthropic.ts` (transcribe-only prompt),
`POST /api/extract`. Code complete + build-verified. Synthetic ground-truth fixtures in
`public/labels/`. ⏳ Live smoke test (seed image → JSON + latency) DEFERRED until
`ANTHROPIC_API_KEY` is available.

## Step 2 — Deterministic matcher + tests  ☑
`lib/matcher.ts` (tolerant fields, ABV tolerance, net-contents units, gov-warning verbatim,
low-confidence→review, self-check mode) + `lib/applications.ts` (6 mock apps) +
`lib/matcher.test.ts`. Verified: **37/37 vitest tests pass**, build typecheck clean.

## Step 3 — Single-label review UI  ◐
`POST /api/review` + `GET /api/applications`; accessible page (3 input modes: mock app / manual
/ self-check), color-coded per-field result cards with text+symbol status (not color alone),
"Analyzed in X.Xs", plain-language errors, focus management + aria-live. Build-verified; UI
verified in browser (semantics, dropdown, mode-switching, no console errors).
⏳ Live "Analyze" flow (needs key) DEFERRED.

## Step 4 — Batch review  ◐
`POST /api/batch` (bounded concurrency pool); batch UI with per-file status + expandable field
details; nav between single/batch.
_Later reworked (see STATE.md): batch is now client-chunked + synchronous (no job store/polling),
and the in-app `$5` spend cap was removed by owner decision — Claude spend is controlled by the
account-level usage limit in the Anthropic Console instead._

## Step 5 — Security hardening  ☑
`lib/rateLimit.ts` (per-IP, 20/10min) on all credit-spending routes; MIME allowlist + size cap;
free-text caps; security headers in `next.config.ts`; `SECURITY.md` (STRIDE-style + accepted
risks). Verified: headers present; 21st request → `429` + `Retry-After: 599`; bad upload → `400`;
key server-only.

## Step 6 — Docs + deploy  ☐
`README.md` ☑ (approach, tradeoffs, setup, latency, cloud-vs-firewall note). ⏳ Deploy to Vercel
with `ANTHROPIC_API_KEY` + run the deferred live tests — needs the user's Vercel login + key.
Fill measured latency numbers into README after the first live run.

---

## Feature Proposals
_Ideas surfaced by the agent that weren't explicitly requested. Discuss keep/cut before building._

- _(none yet)_
