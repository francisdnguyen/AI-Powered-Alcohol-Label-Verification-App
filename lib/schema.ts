import { z } from "zod";

/**
 * The seven fields TTB agents verify on an alcohol beverage label.
 * Order here is the canonical display order used across the UI and prompts.
 */
export const LABEL_FIELDS = [
  "brandName",
  "classType",
  "alcoholContent",
  "netContents",
  "producerNameAddress",
  "countryOfOrigin",
  "governmentWarning",
] as const;

export type LabelFieldKey = (typeof LABEL_FIELDS)[number];

/** Human-facing metadata + per-field transcription guidance for the model. */
export const FIELD_META: Record<
  LabelFieldKey,
  { label: string; hint: string; strict?: boolean }
> = {
  brandName: {
    label: "Brand name",
    hint: "The brand or trade name, usually the most prominent text on the label.",
  },
  classType: {
    label: "Class / type designation",
    hint: 'The beverage class or type, e.g. "Kentucky Straight Bourbon Whiskey", "Cabernet Sauvignon", "India Pale Ale".',
  },
  alcoholContent: {
    label: "Alcohol content",
    hint: 'Alcohol by volume as printed, e.g. "40% ALC/VOL", "13.5% ABV", "5% Alc. by Vol.".',
  },
  netContents: {
    label: "Net contents",
    hint: 'The stated volume, e.g. "750 mL", "12 FL OZ", "1 L".',
  },
  producerNameAddress: {
    label: "Producer name & address",
    hint: 'The bottler/producer/importer statement, e.g. "Bottled by Acme Distillers, Louisville, KY".',
  },
  countryOfOrigin: {
    label: "Country of origin",
    hint: 'Country of origin if stated, e.g. "Product of France", "Made in USA".',
  },
  governmentWarning: {
    label: "Government warning",
    hint: "The full GOVERNMENT WARNING statement, transcribed verbatim exactly as printed, including capitalization and punctuation.",
    strict: true,
  },
};

export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

/**
 * Overall legibility of the whole image, self-reported by the model. Lets the app tell a *photo*
 * problem ("can't read this — send a clearer image") apart from a *compliance* problem, instead of
 * grading an unreadable label as a pile of mismatches. Distinct from per-field `confidence`.
 */
export const IMAGE_QUALITY = ["clear", "partial", "poor"] as const;
export type ImageQuality = (typeof IMAGE_QUALITY)[number];

/**
 * One transcribed field. `value` is the verbatim text as read from the label,
 * or null when the field is not visible/present. `found` mirrors that in a
 * boolean for convenience, and `confidence` is the model's self-reported
 * legibility for THIS field (used later to force human review on shaky reads).
 */
export const fieldValueSchema = z.object({
  value: z.string().nullable(),
  confidence: z.enum(CONFIDENCE_LEVELS),
  found: z.boolean(),
});

export type FieldValue = z.infer<typeof fieldValueSchema>;

/** The full transcription result: every field, always present as an object. */
export const extractedLabelSchema = z.object({
  brandName: fieldValueSchema,
  classType: fieldValueSchema,
  alcoholContent: fieldValueSchema,
  netContents: fieldValueSchema,
  producerNameAddress: fieldValueSchema,
  countryOfOrigin: fieldValueSchema,
  governmentWarning: fieldValueSchema,
  // Overall image legibility. `.catch` defaults a missing/invalid value to "clear" so a quality
  // field can never fail the whole extraction — the safe default is "don't flag".
  imageQuality: z.enum(IMAGE_QUALITY).catch("clear"),
});

export type ExtractedLabel = z.infer<typeof extractedLabelSchema>;

/** Timing breakdown returned to the client so latency is measured, not assumed. */
export interface ExtractTiming {
  imageMs: number;
  aiMs: number;
  totalMs: number;
}

export interface ExtractResponse {
  fields: ExtractedLabel;
  timing: ExtractTiming;
  model: string;
}
