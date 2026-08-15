import {
  FIELD_META,
  LABEL_FIELDS,
  type Confidence,
  type ExtractedLabel,
  type ExtractTiming,
  type ImageQuality,
  type LabelFieldKey,
} from "./schema";
import { TTB_GOVERNMENT_WARNING, TTB_WARNING_PREFIX } from "./ttb";

/** How the label's expected values were supplied. */
export type ReviewMode = "application" | "manual" | "self";

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

/** Coarse beverage family — a level above the TTB class/type designation. */
export type BeverageCategory = "Beer" | "Wine" | "Spirits";

export interface ReviewResult {
  fields: FieldResult[];
  summary: ReviewSummary;
  /** "pass" only when every field cleanly matches; otherwise agent attention needed. */
  overall: "pass" | "attention";
  /** The model's overall legibility read, passed through so the recommendation can flag a bad photo. */
  imageQuality: ImageQuality;
  /**
   * Best-effort Beer/Wine/Spirits classification derived *deterministically* from the class/type
   * designation the model read (e.g. "IPA" → Beer, "Tawny Port" → Wine, "Straight Bourbon" →
   * Spirits). Null when the class/type is missing or unrecognized. The model still only transcribes;
   * this categorization is plain code (invariant 1), and the UI lets an agent override it.
   */
  beverageType: BeverageCategory | null;
}

/** Full payload returned by POST /api/review. */
export interface ReviewResponse {
  extracted: ExtractedLabel;
  review: ReviewResult;
  timing: ExtractTiming;
  model: string;
  mode: ReviewMode;
  applicationId?: string;
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
  // "80 proof", "80° proof", "80°proof" — a degree mark may sit between the number and the word.
  const proof = s.match(/(\d+(?:\.\d+)?)\s*°?\s*proof/i);
  if (proof) return parseFloat(proof[1]) / 2;
  // Bare degree mark in US proof style ("151°"). Skip "°P" (degrees Plato — a beer wort measure,
  // not proof) so a beer strength isn't misread as alcohol content.
  const degree = s.match(/(\d+(?:\.\d+)?)\s*°(?!\s*[pP])/);
  if (degree) return parseFloat(degree[1]) / 2;
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

/** Levenshtein edit distance (insert/delete/substitute). Exported for direct unit testing. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}

/**
 * Company/entity suffix words that don't distinguish one product from another. Used to accept a
 * shorter name inside a longer one ("Sierra Nevada" vs "Sierra Nevada Brewing Co.") while still
 * flagging a genuine product differentiator ("Silver Creek" vs "Silver Creek Reserve"): "reserve"
 * is not in this set, so that stays a review, not an auto-match.
 */
const CORPORATE_FILLER = new Set([
  "co", "company", "companies", "inc", "incorporated", "llc", "llp", "ltd", "limited",
  "corp", "corporation", "plc", "brewing", "brewery", "breweries", "brewers", "winery",
  "wineries", "vintners", "vineyard", "vineyards", "cellars", "cellar", "estate", "estates",
  "distillery", "distilleries", "distillers", "distilling", "spirits", "beverage", "beverages",
  "imports", "importers", "sons", "bros", "brothers", "group", "holdings", "cooperage",
]);

/**
 * True when `shorter` appears as a contiguous run of whole words inside `longer` and every extra
 * word in `longer` is a corporate/entity suffix. Single-word forms under 4 characters are rejected
 * to avoid matching on short filler tokens.
 */
function isCorporateTruncation(shorter: string[], longer: string[]): boolean {
  if (shorter.length === 0 || shorter.length >= longer.length) return false;
  if (shorter.length === 1 && shorter[0].length < 4) return false;
  for (let start = 0; start + shorter.length <= longer.length; start++) {
    let matched = true;
    for (let j = 0; j < shorter.length; j++) {
      if (longer[start + j] !== shorter[j]) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    const extra = [...longer.slice(0, start), ...longer.slice(start + shorter.length)];
    if (extra.every((w) => CORPORATE_FILLER.has(w))) return true;
  }
  return false;
}

/**
 * True when two equal-length word lists differ in exactly one position and that word pair looks
 * like an OCR slip (short edit distance on a word of at least 4 characters). Lets a single misread
 * character become a "double-check this" review instead of a hard mismatch.
 */
function singleWordMisread(a: string[], b: string[]): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diffIdx = -1;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      if (diffIdx !== -1) return false; // more than one differing word
      diffIdx = i;
    }
  }
  if (diffIdx === -1) return false;
  const wa = a[diffIdx];
  const wb = b[diffIdx];
  const maxLen = Math.max(wa.length, wb.length);
  if (maxLen < 4) return false;
  const budget = Math.max(1, Math.floor(maxLen / 6));
  return levenshtein(wa, wb) <= budget;
}

/**
 * Attribution phrases that prefix a bottler/producer line ("Distilled & Bottled by X"). Stored in
 * normalized form (lowercase, punctuation folded to spaces — so "&" becomes a gap). Longer phrases
 * are listed first so the most specific one strips. Used only for the address field.
 */
const ATTRIBUTION_PREFIXES = [
  "distilled and bottled by", "distilled bottled by",
  "produced and bottled by", "produced bottled by",
  "made and bottled by", "made bottled by",
  "brewed and bottled by", "brewed bottled by",
  "vinted and bottled by", "vinted bottled by",
  "cellared and bottled by", "cellared bottled by",
  "blended and bottled by", "blended bottled by",
  "produced and imported by", "produced imported by",
  "imported and bottled by", "imported bottled by",
  "bottled by", "produced by", "distilled by", "brewed by", "made by",
  "imported by", "packed by", "manufactured by", "vinted by", "cellared by",
];

/** Strip a recognized attribution prefix from an already-normalized address string. */
function stripAttributionPrefix(normalized: string): string {
  for (const p of ATTRIBUTION_PREFIXES) {
    if (normalized === p) return "";
    if (normalized.startsWith(p + " ")) return normalized.slice(p.length + 1);
  }
  return normalized;
}

// ---------------------------------------------------------------------------
// Per-field grading
// ---------------------------------------------------------------------------

interface Verdict {
  status: FieldStatus;
  note: string;
}

function gradeTolerantText(extracted: string, expected: string): Verdict {
  const ne = normalizeText(extracted);
  const nx = normalizeText(expected);
  if (ne === nx) {
    return { status: "match", note: "Matches the application." };
  }
  const ta = ne.split(" ").filter(Boolean);
  const tb = nx.split(" ").filter(Boolean);
  const sim = similarity(extracted, expected);
  if (sim >= 0.9) {
    return { status: "match", note: "Matches, with minor formatting differences." };
  }
  // A shorter name fully inside the longer one where the only extra words are a company suffix,
  // e.g. "Sierra Nevada" vs "Sierra Nevada Brewing Co." A product differentiator like "Reserve"
  // is not a company suffix, so it correctly falls through to a review below.
  if (isCorporateTruncation(ta, tb) || isCorporateTruncation(tb, ta)) {
    return { status: "match", note: "Same name aside from an added company suffix (e.g. \"Brewing Co.\")." };
  }
  // Exactly one word differs by a likely OCR slip — surface it for a quick human check, don't fail.
  if (singleWordMisread(ta, tb)) {
    return {
      status: "review",
      note: "Differs by a single character in one word — likely an OCR misread; double-check it against the label.",
    };
  }
  if (sim >= 0.55) {
    return {
      status: "review",
      note: "Close to the application value but not exact — please verify.",
    };
  }
  return { status: "mismatch", note: "Does not match the application value." };
}

/**
 * Address grading: the tolerant compare first (handles exact/formatting/truncation), then a retry
 * with attribution prefixes stripped from both sides, so "Distilled & Bottled by X" reads as "X".
 */
function gradeAddress(extracted: string, expected: string): Verdict {
  const base = gradeTolerantText(extracted, expected);
  if (base.status === "match") return base;

  const se = stripAttributionPrefix(normalizeText(extracted));
  const sx = stripAttributionPrefix(normalizeText(expected));
  if (se && sx) {
    if (se === sx) {
      return { status: "match", note: "Address matches once the bottling/attribution phrase is set aside." };
    }
    if (similarity(se, sx) >= 0.9) {
      return { status: "match", note: "Address matches aside from the attribution phrase and minor formatting." };
    }
  }
  return base;
}

function gradeAbv(extracted: string, expected: string): Verdict {
  const a = parseAbv(extracted);
  const e = parseAbv(expected);
  if (a !== null && e !== null) {
    // Compliance-strict: allow only a hair of rounding. A real ABV difference is a violation.
    if (Math.abs(a - e) <= 0.05) {
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
    // Text + capitalization are verified verbatim. The one thing a photo transcription can't
    // confirm is the required bold typeface, so ask the agent to eyeball that rather than letting
    // the app imply a fully-verified warning.
    return {
      status: "match",
      note: "Text and capitalization match verbatim. Bold typeface can't be verified from a photo — confirm it visually.",
    };
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
    case "producerNameAddress":
      return gradeAddress(extractedValue, expected);
    default:
      return gradeTolerantText(extractedValue, expected);
  }
}

// ---------------------------------------------------------------------------
// Beverage-type detection (deterministic, from the class/type designation)
// ---------------------------------------------------------------------------

// Checked in order — Beer before Wine so "Porter" (a beer) isn't caught by Wine's "port".
const BEVERAGE_KEYWORDS: { category: BeverageCategory; terms: string[] }[] = [
  {
    category: "Beer",
    terms: [
      "beer", "lager", "ale", "ipa", "stout", "porter", "pilsner", "pilsener", "saison",
      "bock", "hefeweizen", "weizen", "wheat", "kolsch", "kölsch", "gose", "dunkel", "malt liquor",
    ],
  },
  {
    category: "Wine",
    terms: [
      "wine", "cabernet", "merlot", "chardonnay", "sauvignon", "pinot", "riesling", "rosé", "rose",
      "port", "sherry", "sparkling", "champagne", "prosecco", "zinfandel", "syrah", "shiraz",
      "malbec", "tempranillo", "grenache", "vermouth", "brut", "moscato", "muscat", "sangiovese",
      "chianti", "rioja", "sauternes", "gewürztraminer", "gewurztraminer",
    ],
  },
  {
    category: "Spirits",
    terms: [
      "vodka", "whiskey", "whisky", "bourbon", "rye", "scotch", "gin", "rum", "tequila", "mezcal",
      "brandy", "cognac", "liqueur", "reposado", "añejo", "anejo", "blanco", "spirit", "schnapps",
      "absinthe", "grappa", "aquavit", "akvavit", "eau-de-vie",
    ],
  },
];

/**
 * Best-effort Beer/Wine/Spirits classification from a class/type designation. Substring, case-
 * insensitive; returns the first family whose keyword appears, or null if none match. Deterministic
 * and unit-tested — the model never decides this.
 */
export function detectBeverageType(classType?: string | null): BeverageCategory | null {
  if (!classType) return null;
  const lc = classType.toLowerCase();
  for (const { category, terms } of BEVERAGE_KEYWORDS) {
    if (terms.some((t) => lc.includes(t))) return category;
  }
  return null;
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

  const classTypeValue = fields.find((f) => f.key === "classType")?.extracted ?? null;

  return {
    fields,
    summary,
    overall: summary.match === summary.total ? "pass" : "attention",
    imageQuality: extracted.imageQuality,
    beverageType: detectBeverageType(classTypeValue),
  };
}

export type RecommendationLevel = "approve" | "review" | "reject" | "image";

export interface RecommendationResult {
  level: RecommendationLevel;
  label: string;
  reason: string;
}

/**
 * Roll a field-by-field review up into a single agent-facing recommendation. A hard conflict or a
 * missing mandatory field points to rejection; softer "needs review" flags route to a human; a
 * clean sheet is ready to approve.
 */
export function recommendationFor(review: ReviewResult): RecommendationResult {
  const s = review.summary;
  // A photo we can't read is a photo problem, not a compliance verdict — surface it as its own
  // outcome (and above approve/review) so an unreadable label is never quietly passed or failed.
  if (review.imageQuality === "poor") {
    return {
      level: "image",
      label: "Needs a clearer photo",
      reason:
        "The submitted image is too low-quality to verify reliably — request a clearer photo before deciding.",
    };
  }
  if (s.mismatch > 0) {
    return {
      level: "reject",
      label: "Likely rejection",
      reason: `${s.mismatch} field${s.mismatch === 1 ? "" : "s"} conflict with the application.`,
    };
  }
  if (s.missing > 0) {
    return {
      level: "reject",
      label: "Likely rejection",
      reason: `${s.missing} required field${s.missing === 1 ? "" : "s"} missing from the label.`,
    };
  }
  if (s.review > 0) {
    return {
      level: "review",
      label: "Needs agent review",
      reason: `${s.review} field${s.review === 1 ? "" : "s"} need a closer look.`,
    };
  }
  return {
    level: "approve",
    label: "Ready for approval",
    reason: "All fields match the application.",
  };
}
