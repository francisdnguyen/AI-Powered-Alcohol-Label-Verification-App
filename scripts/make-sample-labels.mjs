// Generates synthetic alcohol-label images with KNOWN field values — one per mock COLA application
// in lib/applications.ts — for the review-queue demo and for smoke-testing the extraction pipeline.
// These are clean, upright text (not real photos), so they prove the pipeline works; a few labels
// intentionally diverge from the application data (a wrong ABV, a missing warning, an added brand
// word) so the queue shows a realistic mix of pass / review / likely-rejection once verified.
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

const SPIRITS = { bg: "#f5efe1", ink: "#2a1a0e", accent: "#7a3b12" };
const REDWINE = { bg: "#f7f4ee", ink: "#3a1020", accent: "#6b1030" };
const WHITEWINE = { bg: "#f3f6ee", ink: "#2c3312", accent: "#5c6b18" };
const ROSE = { bg: "#fbeef0", ink: "#4a1526", accent: "#b03a54" };
const BEER = { bg: "#f6efd8", ink: "#3a2a08", accent: "#a9791a" };

// One entry per application id. `fields` is the text as PRINTED on the label — mostly equal to the
// application data, with deliberate divergences called out inline.
const LABELS = [
  { file: "silver-creek.png", ...SPIRITS, fields: {
    brandName: "SILVER CREEK", classType: "Kentucky Straight Bourbon Whiskey",
    alcoholContent: "40% ALC/VOL (80 PROOF)", netContents: "750 mL",
    producerNameAddress: "Distilled & Bottled by Silver Creek Distillers, Frankfort, KY",
    countryOfOrigin: "USA", governmentWarning: WARNING } },
  { file: "meridian-ridge.png", ...REDWINE, fields: {
    brandName: "MERIDIAN RIDGE", classType: "Cabernet Sauvignon",
    alcoholContent: "13.5% ABV", netContents: "750 mL",
    producerNameAddress: "Produced & Bottled by Meridian Ridge Winery, Napa, CA",
    countryOfOrigin: "USA", governmentWarning: WARNING } },
  { file: "harbor-lager.png", ...BEER, fields: {
    brandName: "HARBOR LIGHT LAGER", classType: "Lager Beer",
    alcoholContent: "4.8% ALC/VOL", netContents: "355 mL",
    producerNameAddress: "Harbor Brewing Co., Portland, ME",
    countryOfOrigin: "USA", governmentWarning: WARNING } },
  { file: "chateau-lumiere.png", ...WHITEWINE, fields: {
    brandName: "CHATEAU LUMIERE", classType: "Champagne",
    alcoholContent: "12% ABV", netContents: "750 mL",
    producerNameAddress: "Chateau Lumiere, Reims, France",
    countryOfOrigin: "Product of France", governmentWarning: WARNING } },
  { file: "old-anchor-gin.png", ...SPIRITS, fields: {
    brandName: "OLD ANCHOR", classType: "London Dry Gin",
    alcoholContent: "47% ALC/VOL", netContents: "1 L",
    producerNameAddress: "Old Anchor Distilling, Seattle, WA",
    countryOfOrigin: "USA", governmentWarning: WARNING } },
  { file: "sol-dorado.png", ...SPIRITS, fields: {
    brandName: "SOL DORADO", classType: "Tequila Reposado",
    alcoholContent: "38% ALC/VOL", netContents: "750 mL",
    producerNameAddress: "Destileria Sol Dorado, Jalisco, Mexico",
    countryOfOrigin: "Product of Mexico", governmentWarning: WARNING } },
  { file: "birchwood-rye.png", ...SPIRITS, fields: {
    // Divergence: label brand adds "RESERVE" (a product tier), application says just "Birchwood".
    brandName: "BIRCHWOOD RESERVE", classType: "Straight Rye Whiskey",
    alcoholContent: "45% ALC/VOL", netContents: "750 mL",
    producerNameAddress: "Birchwood Distillery, Bardstown, KY",
    countryOfOrigin: "USA", governmentWarning: WARNING } },
  { file: "costa-verde.png", ...WHITEWINE, fields: {
    // Divergence: label prints 13.5% ABV but the application filed 12.5% — a real ABV mismatch.
    brandName: "COSTA VERDE", classType: "Sauvignon Blanc",
    alcoholContent: "13.5% ABV", netContents: "750 mL",
    producerNameAddress: "Costa Verde Vineyards, Marlborough, New Zealand",
    countryOfOrigin: "Product of New Zealand", governmentWarning: WARNING } },
  { file: "ironclad-ipa.png", ...BEER, fields: {
    // Divergence: label OMITS the mandatory government warning.
    brandName: "IRONCLAD", classType: "India Pale Ale",
    alcoholContent: "6.5% ALC/VOL", netContents: "473 mL",
    producerNameAddress: "Ironclad Brewing Co., Richmond, VA",
    countryOfOrigin: "USA", governmentWarning: "" } },
  { file: "vasco-porto.png", ...REDWINE, fields: {
    brandName: "VASCO", classType: "Tawny Port",
    alcoholContent: "20% ABV", netContents: "750 mL",
    producerNameAddress: "Quinta do Vasco, Douro, Portugal",
    countryOfOrigin: "Product of Portugal", governmentWarning: WARNING } },
  { file: "northwind-vodka.png", ...SPIRITS, fields: {
    brandName: "NORTHWIND", classType: "Vodka",
    alcoholContent: "40% ALC/VOL", netContents: "750 mL",
    producerNameAddress: "Northwind Distilling, Minneapolis, MN",
    countryOfOrigin: "USA", governmentWarning: WARNING } },
  { file: "sunset-rose.png", ...ROSE, fields: {
    brandName: "SUNSET COAST", classType: "Rosé",
    alcoholContent: "11.5% ABV", netContents: "750 mL",
    producerNameAddress: "Bottled by Sunset Coast Cellars, Paso Robles, CA",
    countryOfOrigin: "USA", governmentWarning: WARNING } },
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
  const warnBlock = f.governmentWarning
    ? `<text x="70" y="1230" font-family="Arial, sans-serif" font-size="21" font-weight="700" fill="${label.ink}">${wrap(
        f.governmentWarning,
        60,
      )
        .map((ln, i) => `<tspan x="70" dy="${i === 0 ? 0 : 26}">${esc(ln)}</tspan>`)
        .join("")}</text>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${label.bg}"/>
  <rect x="40" y="40" width="${W - 80}" height="${H - 80}" fill="none" stroke="${label.accent}" stroke-width="4"/>
  <text x="${W / 2}" y="230" text-anchor="middle" font-family="Georgia, serif" font-size="92" font-weight="700" fill="${label.ink}">${esc(f.brandName)}</text>
  <text x="${W / 2}" y="320" text-anchor="middle" font-family="Georgia, serif" font-size="40" font-style="italic" fill="${label.accent}">${esc(f.classType)}</text>
  <text x="${W / 2}" y="470" text-anchor="middle" font-family="Georgia, serif" font-size="46" fill="${label.ink}">${esc(f.alcoholContent)}</text>
  <text x="${W / 2}" y="540" text-anchor="middle" font-family="Georgia, serif" font-size="46" fill="${label.ink}">${esc(f.netContents)}</text>
  <text x="${W / 2}" y="700" text-anchor="middle" font-family="Georgia, serif" font-size="30" fill="${label.ink}">${esc(f.producerNameAddress)}</text>
  <text x="${W / 2}" y="750" text-anchor="middle" font-family="Georgia, serif" font-size="30" fill="${label.ink}">${esc(f.countryOfOrigin)}</text>
  ${warnBlock}
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
