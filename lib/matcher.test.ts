import { describe, expect, it } from "vitest";
import {
  normalizeText,
  similarity,
  levenshtein,
  parseAbv,
  parseVolumeMl,
  reviewLabel,
  type ApplicationData,
} from "./matcher";
import { TTB_GOVERNMENT_WARNING } from "./ttb";
import type {
  Confidence,
  ExtractedLabel,
  FieldValue,
  LabelFieldKey,
} from "./schema";
import type { FieldStatus, ReviewResult } from "./matcher";

// --- helpers ---------------------------------------------------------------

function field(value: string | null, confidence: Confidence = "high"): FieldValue {
  return { value, confidence, found: value !== null };
}

function buildLabel(
  overrides: Partial<Record<LabelFieldKey, FieldValue>> = {},
): ExtractedLabel {
  return {
    brandName: field("Silver Creek"),
    classType: field("Kentucky Straight Bourbon Whiskey"),
    alcoholContent: field("40% ALC/VOL"),
    netContents: field("750 mL"),
    producerNameAddress: field("Silver Creek Distillers, Frankfort, KY"),
    countryOfOrigin: field("USA"),
    governmentWarning: field(TTB_GOVERNMENT_WARNING),
    ...overrides,
  };
}

const silverCreekApp: ApplicationData = {
  brandName: "Silver Creek",
  classType: "Kentucky Straight Bourbon Whiskey",
  alcoholContent: "40% ALC/VOL",
  netContents: "750 mL",
  producerNameAddress: "Silver Creek Distillers, Frankfort, KY",
  countryOfOrigin: "USA",
};

function statusOf(result: ReviewResult, key: LabelFieldKey): FieldStatus {
  const f = result.fields.find((x) => x.key === key);
  if (!f) throw new Error(`no field ${key}`);
  return f.status;
}

// --- normalization + similarity -------------------------------------------

describe("normalizeText", () => {
  it("folds case, strips punctuation, collapses whitespace", () => {
    expect(normalizeText("  Silver-CREEK,  Inc. ")).toBe("silver creek inc");
  });
  it("removes diacritics", () => {
    expect(normalizeText("Château Lumière")).toBe("chateau lumiere");
  });
});

describe("similarity", () => {
  it("is 1 for identical token bags", () => {
    expect(similarity("Silver Creek", "silver  creek")).toBe(1);
  });
  it("is 0 for disjoint text", () => {
    expect(similarity("Golden Oak", "Silver Creek")).toBe(0);
  });
  it("is partial for overlapping text", () => {
    const s = similarity("Silver Creek Reserve", "Silver Creek");
    expect(s).toBeGreaterThan(0.55);
    expect(s).toBeLessThan(0.9);
  });
});

// --- numeric parsers -------------------------------------------------------

describe("parseAbv", () => {
  it("reads a percentage, ignoring trailing proof", () => {
    expect(parseAbv("40% ALC/VOL (80 PROOF)")).toBe(40);
  });
  it("reads decimals and ABV wording", () => {
    expect(parseAbv("13.5% ABV")).toBe(13.5);
  });
  it("falls back to proof / 2 when no percent", () => {
    expect(parseAbv("80 proof")).toBe(40);
  });
  it("returns null when unparseable", () => {
    expect(parseAbv("strong stuff")).toBeNull();
  });
});

describe("parseVolumeMl", () => {
  it("parses mL and L to a common unit", () => {
    expect(parseVolumeMl("750 mL")).toBe(750);
    expect(parseVolumeMl("1 L")).toBe(1000);
    expect(parseVolumeMl("1000 mL")).toBe(1000);
  });
  it("is tolerant of spacing and case", () => {
    expect(parseVolumeMl("750ML")).toBe(750);
  });
  it("parses fluid ounces", () => {
    expect(parseVolumeMl("12 fl oz")).toBeCloseTo(354.88, 1);
  });
  it("returns null for junk", () => {
    expect(parseVolumeMl("a bottle")).toBeNull();
  });
});

// --- government warning (strict / verbatim) --------------------------------

describe("government warning", () => {
  it("matches when verbatim (whitespace-insensitive)", () => {
    const r = reviewLabel(
      buildLabel({ governmentWarning: field(`  ${TTB_GOVERNMENT_WARNING}  `) }),
      silverCreekApp,
    );
    expect(statusOf(r, "governmentWarning")).toBe("match");
  });
  it("flags altered wording as mismatch", () => {
    const altered = TTB_GOVERNMENT_WARNING.replace(
      "birth defects",
      "birth complications",
    );
    const r = reviewLabel(
      buildLabel({ governmentWarning: field(altered) }),
      silverCreekApp,
    );
    expect(statusOf(r, "governmentWarning")).toBe("mismatch");
  });
  it("flags a missing GOVERNMENT WARNING: prefix", () => {
    const noPrefix = TTB_GOVERNMENT_WARNING.replace("GOVERNMENT WARNING: ", "");
    const r = reviewLabel(
      buildLabel({ governmentWarning: field(noPrefix) }),
      silverCreekApp,
    );
    expect(statusOf(r, "governmentWarning")).toBe("mismatch");
  });
  it("reports missing when not on the label", () => {
    const r = reviewLabel(
      buildLabel({ governmentWarning: field(null) }),
      silverCreekApp,
    );
    expect(statusOf(r, "governmentWarning")).toBe("missing");
  });
});

// --- end-to-end grading ----------------------------------------------------

describe("reviewLabel against an application", () => {
  it("passes cleanly when the label matches the application", () => {
    const r = reviewLabel(buildLabel(), silverCreekApp);
    expect(r.overall).toBe("pass");
    expect(r.summary.match).toBe(7);
  });

  it("treats ABV as equal across format differences", () => {
    const r = reviewLabel(
      buildLabel({ alcoholContent: field("40% ALC/VOL") }),
      { ...silverCreekApp, alcoholContent: "40% ABV" },
    );
    expect(statusOf(r, "alcoholContent")).toBe("match");
  });

  it("flags an ABV that is numerically different", () => {
    const r = reviewLabel(buildLabel({ alcoholContent: field("45% ALC/VOL") }), {
      ...silverCreekApp,
      alcoholContent: "40% ALC/VOL",
    });
    expect(statusOf(r, "alcoholContent")).toBe("mismatch");
  });

  it("treats equal volumes in different units as a match", () => {
    const r = reviewLabel(buildLabel({ netContents: field("1000 mL") }), {
      ...silverCreekApp,
      netContents: "1 L",
    });
    expect(statusOf(r, "netContents")).toBe("match");
  });

  it("flags a different volume as mismatch", () => {
    const r = reviewLabel(buildLabel({ netContents: field("1 L") }), {
      ...silverCreekApp,
      netContents: "750 mL",
    });
    expect(statusOf(r, "netContents")).toBe("mismatch");
  });

  it("marks a near-but-not-exact brand as review", () => {
    const r = reviewLabel(buildLabel({ brandName: field("Silver Creek Reserve") }), silverCreekApp);
    expect(statusOf(r, "brandName")).toBe("review");
  });

  it("marks a clearly different brand as mismatch", () => {
    const r = reviewLabel(buildLabel({ brandName: field("Golden Oak") }), silverCreekApp);
    expect(statusOf(r, "brandName")).toBe("mismatch");
  });

  it("reports a field expected by the application but missing on the label", () => {
    const r = reviewLabel(buildLabel({ countryOfOrigin: field(null) }), silverCreekApp);
    expect(statusOf(r, "countryOfOrigin")).toBe("missing");
  });

  it("downgrades a low-confidence clean match to review", () => {
    const r = reviewLabel(
      buildLabel({ brandName: field("Silver Creek", "low") }),
      silverCreekApp,
    );
    expect(statusOf(r, "brandName")).toBe("review");
  });
});

// --- nuanced matching (truncation / attribution / OCR misread) -------------

describe("levenshtein", () => {
  it("counts single-character edits", () => {
    expect(levenshtein("creek", "creek")).toBe(0);
    expect(levenshtein("creek", "creok")).toBe(1);
    expect(levenshtein("", "creek")).toBe(5);
  });
});

describe("nuanced field matching", () => {
  it("treats an added company suffix as a match", () => {
    const r = reviewLabel(
      buildLabel({ brandName: field("Silver Creek Distillers") }),
      silverCreekApp,
    );
    expect(statusOf(r, "brandName")).toBe("match");
  });

  it("still flags a product differentiator like Reserve as review", () => {
    const r = reviewLabel(
      buildLabel({ brandName: field("Silver Creek Reserve") }),
      silverCreekApp,
    );
    expect(statusOf(r, "brandName")).toBe("review");
  });

  it("accepts a bottler address that only adds an attribution prefix", () => {
    const r = reviewLabel(
      buildLabel({
        producerNameAddress: field(
          "Distilled & Bottled by Silver Creek Distillers, Frankfort, KY",
        ),
      }),
      silverCreekApp,
    );
    expect(statusOf(r, "producerNameAddress")).toBe("match");
  });

  it("flags a single likely OCR misread as review, not mismatch", () => {
    const r = reviewLabel(buildLabel({ brandName: field("Silver Creok") }), silverCreekApp);
    expect(statusOf(r, "brandName")).toBe("review");
  });
});

// --- self-check mode (no application) --------------------------------------

describe("self-check mode (no application)", () => {
  it("still grades the government warning verbatim", () => {
    const r = reviewLabel(buildLabel(), null);
    expect(statusOf(r, "governmentWarning")).toBe("match");
  });
  it("accepts a well-formed ABV on its own terms", () => {
    const r = reviewLabel(buildLabel(), null);
    expect(statusOf(r, "alcoholContent")).toBe("match");
  });
  it("flags other fields for manual review (nothing to compare)", () => {
    const r = reviewLabel(buildLabel(), null);
    expect(statusOf(r, "brandName")).toBe("review");
  });
});
