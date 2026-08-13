/**
 * The federally mandated Alcoholic Beverage Health Warning Statement.
 *
 * Source: 27 CFR 16.21. The wording, order, and the literal "GOVERNMENT WARNING:"
 * prefix (which must appear in capital letters and bold on the label) are fixed by
 * regulation. Junior agents check this VERBATIM — this constant is our source of truth.
 *
 * NOTE (limitation): from a transcription we can verify the exact wording and
 * capitalization, but NOT the required bold typeface. That gap is documented for
 * the reviewing agent rather than silently assumed.
 *
 * ⚠️ CONFIRM WITH USER before relying on this in grading: verify this matches the
 * exact string TTB expects, character for character.
 */
export const TTB_GOVERNMENT_WARNING =
  "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.";

/** The mandated prefix, which must be in caps + bold on the label. */
export const TTB_WARNING_PREFIX = "GOVERNMENT WARNING:";
