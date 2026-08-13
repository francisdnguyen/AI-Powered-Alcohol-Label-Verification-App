import {
  FIELD_META,
  LABEL_FIELDS,
  type Confidence,
  type ExtractedLabel,
  type LabelFieldKey,
} from "./schema";
import { TTB_GOVERNMENT_WARNING, TTB_WARNING_PREFIX } from "./ttb";

/**
 * The deterministic grader. The vision model only transcribes; every match/mismatch
 * decision is made here, in plain testable code. That separation is the whole point:
 * verdicts are repeatable and an adversarial label can't talk its way to "approved".
 */

export type FieldStatus = "match" | "mismatch" | "missing" | "review";

export interface FieldResult {
  key: LabelFieldKey;
  label: string;
  status: FieldStatus;
  extracted: string | null;
  expected: string | null;
  confidence: Confidence;
  note: string;
}

export interface ReviewSummary {
  match: number;
  mismatch: number;
  missing: number;
  review: number;
  total: number;
}

export interface ReviewResult {
  fields: FieldResult[];
  summary: ReviewSummary;
  /** "pass" only when every field cleanly matches; otherwise agent attention needed. */
  overall: "pass" | "attention";
}

/** Expected values from a submitted application. Government warning is NOT here —
 *  it is always graded against the canonical TTB text, never applicant-supplied. */
export interface ApplicationData {
  brandName?: string | null;
  classType?: string | null;
  alcoholContent?: string | null;
  netContents?: string | null;
  producerNameAddress?: string | null;
  countryOfOrigin?: string | null;
}

// ---------------------------------------------------------------------------
// Normalization + similarity helpers (exported for direct unit testing)
// ---------------------------------------------------------------------------

/** Case-fold, strip punctuation/diacritics, collapse whitespace. For tolerant compares. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // drop combining marks
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Dice coefficient over word tokens. 1 = identical token bags, 0 = disjoint. */
export function similarity(a: string, b: string): number {
  const ta = normalizeText(a).split(" ").filter(Boolean);
  const tb = normalizeText(b).split(" ").filter(Boolean);
  if (ta.length === 0 && tb.length === 0) return 1;
  if (ta.length === 0 || tb.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const t of tb) counts.set(t, (counts.get(t) ?? 0) + 1);
  let intersection = 0;
  for (const t of ta) {
    const c = counts.get(t) ?? 0;
    if (c > 0) {
      intersection++;
      counts.set(t, c - 1);
    }
  }
  return (2 * intersection) / (ta.length + tb.length);
}

/** Pull an alcohol-by-volume percentage from free text. Falls back to proof/2. */
export function parseAbv(s: string): number | null {
  const pct = s.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pct) return parseFloat(pct[1]);
  const proof = s.match(/(\d+(?:\.\d+)?)\s*proof/i);
  if (proof) return parseFloat(proof[1]) / 2;
  return null;
}

const UNIT_TO_ML: Record<string, number> = {
  ml: 1,
  cl: 10,
  l: 1000,
  floz: 29.5735,
};

/** Parse a net-contents string to milliliters, unit-aware. null if unrecognized. */
export function parseVolumeMl(s: string): number | null {
  const t = s
    .toLowerCase()
    .replace(/,/g, "")
    .replace(/\bfl\.?\s*oz\b/g, "floz")
    .replace(/\bfluid\s+ounces?\b/g, "floz")
    .replace(/\bmillilit(?:er|re)s?\b/g, "ml")
    .replace(/\bcentilit(?:er|re)s?\b/g, "cl")
    .replace(/\blit(?:er|re)s?\b/g, "l");
  const m = t.match(/(\d+(?:\.\d+)?)\s*(floz|ml|cl|l)\b/);
  if (!m) return null;
  const factor = UNIT_TO_ML[m[2]];
  if (!factor) return null;
  return parseFloat(m[1]) * factor;
}

/** Collapse whitespace only — preserves case and punctuation for verbatim compares. */
function tightenWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Per-field grading
// ---------------------------------------------------------------------------

interface Verdict {
  status: FieldStatus;
  note: string;
}

function gradeTolerantText(extracted: string, expected: string): Verdict {
  if (normalizeText(extracted) === normalizeText(expected)) {
    return { status: "match", note: "Matches the application." };
  }
  const sim = similarity(extracted, expected);
  if (sim >= 0.9) {
    return { status: "match", note: "Matches, with minor formatting differences." };
  }
  if (sim >= 0.55) {
    return {
      status: "review",
      note: "Close to the application value but not exact — please verify.",
    };
  }
  return { status: "mismatch", note: "Does not match the application value." };
}

function gradeAbv(extracted: string, expected: string): Verdict {
  const a = parseAbv(extracted);
  const e = parseAbv(expected);
  if (a !== null && e !== null) {
    if (Math.abs(a - e) <= 0.1) {
      return { status: "match", note: `Alcohol content matches (${a}%).` };
    }
    return {
      status: "mismatch",
      note: `Label reads ${a}% but the application says ${e}%.`,
    };
  }
  // Couldn't parse one side numerically — fall back to text.
  return gradeTolerantText(extracted, expected);
}

function gradeVolume(extracted: string, expected: string): Verdict {
  const a = parseVolumeMl(extracted);
  const e = parseVolumeMl(expected);
  if (a !== null && e !== null) {
    if (Math.abs(a - e) < 0.5) {
      return { status: "match", note: "Net contents match." };
    }
    return {
      status: "mismatch",
      note: `Label reads ${extracted} but the application says ${expected}.`,
    };
  }
  return gradeTolerantText(extracted, expected);
}

function gradeGovernmentWarning(extracted: string): Verdict {
  const got = tightenWhitespace(extracted);
  const want = tightenWhitespace(TTB_GOVERNMENT_WARNING);
  if (got === want) {
    return { status: "match", note: "Government warning is present and verbatim." };
  }
  if (!got.startsWith(TTB_WARNING_PREFIX)) {
    return {
      status: "mismatch",
      note: 'Warning must begin exactly with "GOVERNMENT WARNING:" — it does not.',
    };
  }
  return {
    status: "mismatch",
    note: "Government warning wording differs from the required statement. It must be exact.",
  };
}

/** Grade one non-warning field given an optional expected value (null = self-check). */
function gradeField(
  key: Exclude<LabelFieldKey, "governmentWarning">,
  extractedValue: string,
  expected: string | null,
): Verdict {
  if (expected === null) {
    // Self-check mode: no application value to compare against.
    if (key === "alcoholContent") {
      const abv = parseAbv(extractedValue);
      return abv !== null
        ? { status: "match", note: `Valid alcohol-content format (${abv}%).` }
        : {
            status: "review",
            note: "Could not read a clear ABV — please verify the format.",
          };
    }
    return {
      status: "review",
      note: "No application value to compare against — verify manually.",
    };
  }

  switch (key) {
    case "alcoholContent":
      return gradeAbv(extractedValue, expected);
    case "netContents":
      return gradeVolume(extractedValue, expected);
    default:
      return gradeTolerantText(extractedValue, expected);
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function reviewLabel(
  extracted: ExtractedLabel,
  expected: ApplicationData | null,
): ReviewResult {
  const fields: FieldResult[] = LABEL_FIELDS.map((key) => {
    const field = extracted[key];
    const value =
      field.found && field.value && field.value.trim() !== ""
        ? field.value
        : null;
    const confidence = field.confidence;

    let expectedValue: string | null;
    let verdict: Verdict;

    if (key === "governmentWarning") {
      expectedValue = TTB_GOVERNMENT_WARNING;
      if (value === null) {
        verdict = {
          status: "missing",
          note: "Government warning was not found on the label.",
        };
      } else {
        verdict = gradeGovernmentWarning(value);
      }
    } else {
      expectedValue = expected ? (expected[key] ?? null) : null;
      if (value === null) {
        verdict =
          expectedValue !== null
            ? {
                status: "missing",
                note: "Expected on the application but not found on the label.",
              }
            : { status: "missing", note: "Not found on the label." };
      } else {
        verdict = gradeField(key, value, expectedValue);
      }
    }

    // A shaky read should never silently pass. Downgrade clean matches to review.
    if (confidence === "low" && verdict.status === "match") {
      verdict = {
        status: "review",
        note: `${verdict.note} (Low-confidence read — double-check.)`,
      };
    }

    return {
      key,
      label: FIELD_META[key].label,
      status: verdict.status,
      extracted: value,
      expected: expectedValue,
      confidence,
      note: verdict.note,
    };
  });

  const summary: ReviewSummary = {
    match: 0,
    mismatch: 0,
    missing: 0,
    review: 0,
    total: fields.length,
  };
  for (const f of fields) summary[f.status]++;

  return {
    fields,
    summary,
    overall: summary.match === summary.total ? "pass" : "attention",
  };
}
