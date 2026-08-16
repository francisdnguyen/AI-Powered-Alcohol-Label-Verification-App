/**
 * The federally mandated Alcoholic Beverage Health Warning Statement (27 CFR 16.21).
 *
 * Stored in ALL CAPITAL LETTERS: the statement is required on the label in all caps (with
 * "GOVERNMENT WARNING" additionally in bold type). We grade the transcription against this canonical
 * all-caps text VERBATIM — a warning with the right wording but not in all caps is flagged. This
 * constant is our single source of truth.
 *
 * NOTE (limitation): a transcription can verify the exact wording and the ALL-CAPS casing, but NOT
 * the required bold typeface — that gap is surfaced for the reviewing agent, not silently assumed.
 */
export const TTB_GOVERNMENT_WARNING =
  "GOVERNMENT WARNING: (1) ACCORDING TO THE SURGEON GENERAL, WOMEN SHOULD NOT DRINK ALCOHOLIC BEVERAGES DURING PREGNANCY BECAUSE OF THE RISK OF BIRTH DEFECTS. (2) CONSUMPTION OF ALCOHOLIC BEVERAGES IMPAIRS YOUR ABILITY TO DRIVE A CAR OR OPERATE MACHINERY, AND MAY CAUSE HEALTH PROBLEMS.";

/** The mandated prefix, which must be in caps + bold on the label. */
export const TTB_WARNING_PREFIX = "GOVERNMENT WARNING:";
