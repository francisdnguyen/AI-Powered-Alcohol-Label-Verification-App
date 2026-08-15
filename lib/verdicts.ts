/**
 * Persisted AI verdicts for the review queue. Sibling to `dispositions.ts`: that file stores the
 * human's decision (approve/reject/…); this one stores the *machine's* recommendation from the last
 * verification run so the queue can show a "checked / not run" column and reopening an application
 * restores its result without re-spending a Claude call. Prototype-scale only — localStorage is
 * per-browser; production would persist the verdict server-side against the COLA record.
 *
 * A verdict is advisory. It never sets a disposition on its own — a human still records the decision.
 */

import type { RecommendationResult, ReviewResult } from "./matcher";

export interface StoredVerdict {
  /** The deterministic roll-up (approve / review / reject) shown as the queue's "AI check" badge. */
  recommendation: RecommendationResult;
  /** Full field-by-field result, so the review page can restore the cards without re-running. */
  review: ReviewResult;
  /** Epoch ms when this verdict was produced. */
  verifiedAt: number;
  /** Analysis wall-time in ms, when known. */
  totalMs?: number;
  /** Model id that produced it, when known. */
  model?: string;
}

const KEY = "ttb-verdicts";
export const VERDICTS_CHANGED_EVENT = "ttb-verdicts-changed";

export function loadVerdicts(): Record<string, StoredVerdict> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    // Self-heal against corrupt/tampered storage (a JSON primitive or array): callers index and
    // assign into this object, which would throw on a non-object. Fall back to an empty map.
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Record<string, StoredVerdict>;
  } catch {
    return {};
  }
}

export function getVerdict(id: string): StoredVerdict | undefined {
  return loadVerdicts()[id];
}

export function setVerdict(id: string, verdict: StoredVerdict): void {
  if (typeof window === "undefined") return;
  const all = loadVerdicts();
  all[id] = verdict;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(all));
    // Let the queue / other open tabs refresh their "AI check" column.
    window.dispatchEvent(new Event(VERDICTS_CHANGED_EVENT));
  } catch {
    /* storage full or blocked — non-fatal for a prototype */
  }
}

export function clearVerdict(id: string): void {
  if (typeof window === "undefined") return;
  const all = loadVerdicts();
  if (!(id in all)) return;
  delete all[id];
  try {
    window.localStorage.setItem(KEY, JSON.stringify(all));
    window.dispatchEvent(new Event(VERDICTS_CHANGED_EVENT));
  } catch {
    /* storage full or blocked — non-fatal for a prototype */
  }
}
