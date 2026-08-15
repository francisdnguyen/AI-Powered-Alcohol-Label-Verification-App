# EVALUATION.md — extraction accuracy

How well does the pipeline actually *read* a label? This measures **transcription accuracy** — the
vision model's job — separately from the deterministic grader, which is covered by unit tests
(`lib/matcher.test.ts`, 37 cases). Extraction is the one probabilistic step; everything downstream is
plain code, so it's the part that warrants a measured number rather than a claim.

## Why we can measure it cheaply

The demo labels aren't hand-labeled — they're **generated from known field values** by
`scripts/make-sample-labels.mjs`, which writes the printed text of every label to
`public/labels/ground-truth.json` (including the deliberate divergences: Birchwood's added "RESERVE",
Costa Verde's wrong ABV, Ironclad's missing warning). That file **is** the ground truth, so we get an
exact answer key for free.

## Method

`eval/run-eval.mjs` POSTs each label image to the running app's `/api/extract` and scores the
returned per-field value against the printed truth:

- **Text fields** (brand, class/type, producer, country): correct if the normalized strings match or
  token-similarity ≥ 0.9 — tolerant of case/punctuation/whitespace, so it measures *reading*, not
  formatting.
- **Alcohol / net contents**: parsed numerically (40% ≡ 40.0%; 750 mL ≡ 750 ml), ±0.05% / ±0.5 mL.
- **Government warning**: verbatim (≥ 0.98), and for a label with no warning, "correct" means the
  model reports it **absent** (found = false).

The scorers are intentionally **small and independent of `lib/matcher.ts`** — an eval that reused the
grader's own normalization could hide the grader's blind spots.

## Reproduce

```bash
# one shell — app running with a real ANTHROPIC_API_KEY
npm run dev
# another shell
npm run eval          # → prints the summary, writes eval/results.json
# against a deploy instead of localhost:
EVAL_BASE_URL=https://<your-app>.vercel.app npm run eval
```

(The eval needs a live API key and the running app, so it is **not** part of the no-key unit suite —
`npm test` still runs offline.)

## Results

`claude-haiku-4-5-20251001`, 12 synthetic labels, run 2026-08-15 — full per-label detail in
[`eval/results.json`](eval/results.json).

**Overall: 79/84 fields correct = 94% · 8/12 labels fully correct.**

| Field | Transcription accuracy |
|---|---|
| Brand name | 91.7% |
| Class / type | 100% |
| Alcohol content | 100% |
| Net contents | 100% |
| Producer name & address | 83.3% |
| Country of origin | 83.3% |
| Government warning | 100% |

## What the misses tell us (the point of running it)

Four of the five misses are **one systematic weakness**: on *domestic (USA)* labels, where the
producer line and the "USA" country line sit on adjacent centered rows, the model folds "USA" into
the producer address and leaves `countryOfOrigin` empty (Birchwood, Northwind) or drops it
(Ironclad). The fifth is a plain character misread ("HARBOR LIGHT LAGER" → "ARBOR LIGHT LAGE").

- **Downstream impact:** the country/producer merge would surface as a spurious "country missing"
  review flag on some domestic labels — it degrades to *human review*, never a wrong auto-verdict
  (the grader is deterministic), which is the safe failure direction.
- **Fix direction (prompt tuning):** instruct the model that country of origin is its own line and
  must not be absorbed into the bottler statement. A future `PROMPT_TUNING.md` would log that change
  and re-run this eval to confirm the country row recovers.

## Caveats

- **Synthetic, legible labels**, not phone photos — this measures the pipeline on clean input. Real
  photos (angles, glare, low light) read worse, which is exactly why extraction reports a per-field
  **confidence** and shaky reads are forced to human review rather than trusted.
- **Small n (12).** The generator can produce more; the harness scores whatever is in
  `ground-truth.json`. Treat 94% as directional, not a certified rate.
