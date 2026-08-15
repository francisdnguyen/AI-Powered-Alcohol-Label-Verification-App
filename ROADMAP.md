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

## Step 7 — Full console (bulk verify + persisted verdicts)  ☑
Bulk verify from the queue: multi-select rows → "Verify selected" fetches each label and POSTs to
`/api/batch` in a new `mode:"queue"` (each image paired with its own `applicationId`), so N filings
are graded in one pass. Persisted AI verdicts (`lib/verdicts.ts`, localStorage) let a reopened review
restore its result without re-running the model; a human still records the disposition. The client
verify path lives in `lib/bulkVerify.ts`. Verified live in-browser (2-label bulk verify graded each
against its own filing; reopen restored with no `/api/review` call) and `next build` + 50/50 vitest.

_Iterated with the owner:_ a first "AI check" column read "Not run" on every unverified row and a
separate `/board` match board duplicated the queue — both were cut. The column came back in a lighter
form: a per-row verdict **pill** that appears only once a label has been checked (blank otherwise),
with an indeterminate "Verifying N labels…" indicator during a bulk run and the pills filling in when
the single `/api/batch` request resolves. The board stayed gone — neither peer console had one.

_Follow-up — cancellable bulk run:_ `bulkVerify` now accepts an `AbortSignal` (checked before each
label fetch/chunk, forwarded to both `fetch`es); the action bar shows a **Cancel** button while a run
is in flight. Cancel is client-side — an in-flight chunk's server work may still finish but its result
is discarded, and the selection is kept so the reviewer can retry. `BulkVerifySummary.cancelled` +
`summarize` handle the message. Verified live (12-label run → Cancel → "Verification cancelled.",
selection preserved).

_Follow-up — 6-agent audit pass:_ ran a six-persona review (completion, reality-check, pragmatist,
compliance, spec-match, deep-debug) over the recent work. No critical/high; applied the real findings:
`summarize` now surfaces genuine failures on cancel; per-file verdict persistence is guarded so a
malformed result can't double-count; keyboard focus follows the Verify↔Cancel swap and an unmount
effect aborts an in-flight run; the redundant `verifyTotal` state was dropped; the per-chunk caps were
unified into a client-safe `lib/batchLimits.ts` (single source, no drift) and the two byte/count
chunkers collapsed into one generic `chunkBySize`; dangling `AGENTS.md` doc references were repointed.
`next build` + 60/60 vitest green; refactored cancel flow re-verified live at zero API cost.

## Step 10 — Image-quality outcome  ☑
Extraction self-reports overall `imageQuality` (clear/partial/poor); a **poor** read becomes its own
"Needs a clearer photo" recommendation (new `image` level, top precedence) so an unreadable photo is
never quietly passed or failed — a *photo* problem kept distinct from a *compliance* problem. Blue
banner on review, "Low photo quality" pill in the queue. `lib/schema.ts` + `lib/anthropic.ts` prompt +
`lib/matcher.ts`; +2 tests. Verified live (degraded label → `imageQuality: "poor"` end-to-end).

## Step 9 — Extraction-accuracy eval  ☑
`eval/run-eval.mjs` + `EVALUATION.md`: scores the vision model's transcription against the labels'
known printed values (`public/labels/ground-truth.json` — free ground truth, since the labels are
generated from known fields), independently of the grader. `npm run eval` → `eval/results.json`.
First run (`claude-haiku-4-5`, 12 labels): **94% field-level, 8/12 labels exact**, and it surfaced a
real weakness — on domestic labels the model folds the "USA" country line into the producer address.
Fix direction is prompt tuning (future `PROMPT_TUNING.md`).

## Step 8 — Queue visual pass  ☑
Bring the queue closer to a polished console: stat-tile icons + "Pending review" tile, colour-coded
Type pills (Spirits / Wine / Beer), a flag glyph on High priority, ○/✓/✕/ℹ on status badges, a search
magnifier, and **#** + **Applicant** columns (`components/icons.tsx`, dependency-free inline SVGs).
`next build` + 50/50 vitest green; DOM-verified in-browser, no console errors.

---

## Feature Proposals
_Ideas surfaced by the agent that weren't explicitly requested. Discuss keep/cut before building._

- _(none yet)_
