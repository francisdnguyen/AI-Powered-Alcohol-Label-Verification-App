// Generates synthetic alcohol-label images with KNOWN field values, for local
// smoke-testing the extraction pipeline against ground truth. Not real photos —
// clean, upright text — so they prove the pipeline works, not that it handles glare.
//
// Run: node scripts/make-sample-labels.mjs
// Output: public/labels/*.png  +  public/labels/ground-truth.json

import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public", "labels");

const WARNING =
  "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.";

const LABELS = [
  {
    file: "bourbon-750.png",
    bg: "#f5efe1",
    ink: "#2a1a0e",
    accent: "#7a3b12",
    fields: {
      brandName: "SILVER CREEK",
      classType: "Kentucky Straight Bourbon Whiskey",
      alcoholContent: "40% ALC/VOL (80 PROOF)",
      netContents: "750 mL",
      producerNameAddress:
        "Distilled & Bottled by Silver Creek Distillers, Frankfort, KY",
      countryOfOrigin: "Product of USA",
      governmentWarning: WARNING,
    },
  },
  {
    file: "cabernet-750.png",
    bg: "#f7f4ee",
    ink: "#3a1020",
    accent: "#6b1030",
    fields: {
      brandName: "MERIDIAN RIDGE",
      classType: "Cabernet Sauvignon",
      alcoholContent: "13.5% ABV",
      netContents: "750 mL",
      producerNameAddress:
        "Produced & Bottled by Meridian Ridge Winery, Napa, CA",
      countryOfOrigin: "Made in USA",
      governmentWarning: WARNING,
    },
  },
];

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// naive word-wrap for the warning block
function wrap(text, max) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > max) {
      lines.push(line.trim());
      line = w;
    } else {
      line = (line + " " + w).trim();
    }
  }
  if (line) lines.push(line.trim());
  return lines;
}

function svgFor(label) {
  const W = 1000;
  const H = 1500;
  const f = label.fields;
  const warnLines = wrap(f.governmentWarning, 60);
  const warnTspans = warnLines
    .map(
      (ln, i) =>
        `<tspan x="70" dy="${i === 0 ? 0 : 26}">${esc(ln)}</tspan>`,
    )
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${label.bg}"/>
  <rect x="40" y="40" width="${W - 80}" height="${H - 80}" fill="none" stroke="${label.accent}" stroke-width="4"/>
  <text x="${W / 2}" y="230" text-anchor="middle" font-family="Georgia, serif" font-size="92" font-weight="700" fill="${label.ink}">${esc(f.brandName)}</text>
  <text x="${W / 2}" y="320" text-anchor="middle" font-family="Georgia, serif" font-size="40" font-style="italic" fill="${label.accent}">${esc(f.classType)}</text>
  <text x="${W / 2}" y="470" text-anchor="middle" font-family="Georgia, serif" font-size="46" fill="${label.ink}">${esc(f.alcoholContent)}</text>
  <text x="${W / 2}" y="540" text-anchor="middle" font-family="Georgia, serif" font-size="46" fill="${label.ink}">${esc(f.netContents)}</text>
  <text x="${W / 2}" y="700" text-anchor="middle" font-family="Georgia, serif" font-size="30" fill="${label.ink}">${esc(f.producerNameAddress)}</text>
  <text x="${W / 2}" y="750" text-anchor="middle" font-family="Georgia, serif" font-size="30" fill="${label.ink}">${esc(f.countryOfOrigin)}</text>
  <text x="70" y="1230" font-family="Arial, sans-serif" font-size="21" font-weight="700" fill="${label.ink}">${warnTspans}</text>
</svg>`;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const groundTruth = {};
  for (const label of LABELS) {
    const svg = svgFor(label);
    const out = join(OUT_DIR, label.file);
    await sharp(Buffer.from(svg)).png().toFile(out);
    groundTruth[label.file] = label.fields;
    console.log("wrote", out);
  }
  await writeFile(
    join(OUT_DIR, "ground-truth.json"),
    JSON.stringify(groundTruth, null, 2),
  );
  console.log("wrote ground-truth.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
