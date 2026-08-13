/**
 * Hard spending cap on Claude API usage.
 *
 * Every label analysis costs money (a Haiku 4.5 vision call). To make sure a demo
 * or a runaway batch can't quietly rack up a bill, we track cumulative estimated
 * spend and refuse further Claude calls once it reaches the cap. Per the project
 * owner's instruction: $5.
 *
 * Cost is computed from the API's own reported token usage — exact, not guessed.
 *
 * LIMITATION (prototype): the counter is in-memory. It resets on process restart,
 * and on Vercel each serverless instance has its own counter, so the cap is
 * per-instance, not globally shared. A production build would track spend in a
 * durable store. Documented in SECURITY.md / STATE.md.
 */

// Claude Haiku 4.5 list pricing (USD per million tokens).
const HAIKU_4_5_PRICING = {
  inputPerMTok: 1.0,
  outputPerMTok: 5.0,
  cacheReadPerMTok: 0.1, // 0.1x input
  cacheWritePerMTok: 1.25, // 1.25x input (5-minute TTL)
};

/** Cap in USD. Overridable via env, defaults to $5. */
export const BUDGET_LIMIT_USD = Number.parseFloat(
  process.env.ANALYSIS_BUDGET_USD ?? "5",
);

let spentUsd = 0;

export class BudgetExceededError extends Error {
  constructor() {
    super(
      `Analysis budget of $${BUDGET_LIMIT_USD.toFixed(2)} has been reached. No further label analyses can run.`,
    );
    this.name = "BudgetExceededError";
  }
}

export interface BudgetStatus {
  spentUsd: number;
  limitUsd: number;
  remainingUsd: number;
  exhausted: boolean;
}

export function getBudgetStatus(): BudgetStatus {
  const remainingUsd = Math.max(0, BUDGET_LIMIT_USD - spentUsd);
  return {
    spentUsd,
    limitUsd: BUDGET_LIMIT_USD,
    remainingUsd,
    exhausted: spentUsd >= BUDGET_LIMIT_USD,
  };
}

/** Throw before making a Claude call if the budget is already spent. */
export function assertBudgetAvailable(): void {
  if (spentUsd >= BUDGET_LIMIT_USD) {
    throw new BudgetExceededError();
  }
}

/** Minimal shape of the Anthropic usage object we price from. */
export interface TokenUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** Record actual usage after a call; returns the cost of this call in USD. */
export function recordUsage(usage: TokenUsage): number {
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;

  const cost =
    (input / 1_000_000) * HAIKU_4_5_PRICING.inputPerMTok +
    (output / 1_000_000) * HAIKU_4_5_PRICING.outputPerMTok +
    (cacheRead / 1_000_000) * HAIKU_4_5_PRICING.cacheReadPerMTok +
    (cacheWrite / 1_000_000) * HAIKU_4_5_PRICING.cacheWritePerMTok;

  spentUsd += cost;
  return cost;
}
