// Extraction-accuracy evaluation harness.
//
// Measures how well the vision model TRANSCRIBES a label — separately from the deterministic grader
// (which lib/matcher.test.ts covers). Because scripts/make-sample-labels.mjs draws each label from
// KNOWN field values and writes them to public/labels/ground-truth.json, we have exact ground truth
// for free — no hand-labeling. The harness POSTs each label image to the running app's /api/extract
// and scores the returned per-field value against the printed truth.
//
// The scorers below are deliberately SMALL and INDEPENDENT of lib/matcher.ts: an eval that reused the
// grader's own normalization could hide the grader's blind spots. This measures raw reading, tolerant
// only of formatting (case/punctuation/whitespace) and numeric formatting (40% == 40.0%).
//
// Run (needs the app running with a real ANTHROPIC_API_KEY):
//   node node_modules/next/dist/bin/next dev      # in one shell
//   node eval/run-eval.mjs                        # in another (or: npm run eval)
// Optional: EVAL_BASE_URL=https://your-deploy.vercel.app node eval/run-eval.mjs
//
// Writes eval/results.json and prints a per-field + overall summary.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const LABELS_DIR = join(ROOT, "public", "labels");
const BASE = process.env.EVAL_BASE_URL || "http://localhost:3000";

const FIELDS = [
  "brandName",
  "classType",
  "alcoholContent",
  "netContents",
  "producerNameAddress",
  "countryOfOrigin",
  "governmentWarning",
];

// --- independent scorers (NOT imported from lib/matcher) ---
function normText(s) {
  return (s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
/** Dice coefficient over word tokens — 1 identical, 0 disjoint. */
function dice(a, b) {
  const ta = normText(a).split(" ").filter(Boolean);
  const tb = normText(b).split(" ").filter(Boolean);
  if (!ta.length && !tb.length) return 1;
  if (!ta.length || !tb.length) return 0;
  const counts = new Map();
  for (const t of tb) counts.set(t, (counts.get(t) ?? 0) + 1);
  let inter = 0;
  for (const t of ta) {
    const c = counts.get(t) ?? 0;
    if (c > 0) {
      inter++;
      counts.set(t, c - 1);
    }
  }
  return (2 * inter) / (ta.length + tb.length);
}
function firstNumber(s) {
  const m = (s ?? "").match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}
function volumeMl(s) {
  const t = (s ?? "").toLowerCase().replace(/,/g, "");
  const m = t.match(/(\d+(?:\.\d+)?)\s*(ml|cl|l|fl\s?oz|floz)\b/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const u = m[2].replace(/\s/g, "");
  if (u === "ml") return n;
  if (u === "cl") return n * 10;
  if (u === "l") return n * 1000;
  return n * 29.5735; // fl oz
}

/** Score one field's transcription. Returns whether the value and the found/absent call were right. */
function scoreField(key, expectedRaw, ev) {
  const expected = expectedRaw ?? "";
  const expectPresent = expected.trim() !== "";
  const value = ev?.value ?? "";
  const found = !!ev?.found && value.trim() !== "";
  const foundCorrect = found === expectPresent;

  let valueCorrect;
  if (!expectPresent) {
    valueCorrect = !found; // right to report it absent
  } else if (!found) {
    valueCorrect = false; // missed a field that is present
  } else if (key === "alcoholContent") {
    const a = firstNumber(value);
    const b = firstNumber(expected);
    valueCorrect = a !== null && b !== null && Math.abs(a - b) <= 0.05;
  } else if (key === "netContents") {
    const a = volumeMl(value);
    const b = volumeMl(expected);
    valueCorrect = a !== null && b !== null && Math.abs(a - b) < 0.5;
  } else if (key === "governmentWarning") {
    valueCorrect = normText(value) === normText(expected) || dice(value, expected) >= 0.98;
  } else {
    valueCorrect = normText(value) === normText(expected) || dice(value, expected) >= 0.9;
  }

  return {
    expected,
    extracted: value,
    confidence: ev?.confidence ?? null,
    found,
    expectPresent,
    foundCorrect,
    valueCorrect,
  };
}

async function extract(file, buffer) {
  const fd = new FormData();
  fd.append("image", new Blob([buffer], { type: "image/png" }), file);
  const res = await fetch(`${BASE}/api/extract`, { method: "POST", body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data; // { fields, timing, model }
}

async function main() {
  const truth = JSON.parse(await readFile(join(LABELS_DIR, "ground-truth.json"), "utf8"));
  const files = Object.keys(truth);
  console.log(`Evaluating ${files.length} labels against ${BASE}/api/extract …\n`);

  const perLabel = [];
  let model = null;

  for (const file of files) {
    process.stdout.write(`  ${file.padEnd(22)} `);
    try {
      const buffer = await readFile(join(LABELS_DIR, file));
      const { fields, model: m } = await extract(file, buffer);
      if (!model) model = m ?? null;
      const scored = {};
      for (const key of FIELDS) scored[key] = scoreField(key, truth[file][key], fields[key]);
      const allValueCorrect = FIELDS.every((k) => scored[k].valueCorrect);
      perLabel.push({ file, allValueCorrect, fields: scored });
      const right = FIELDS.filter((k) => scored[k].valueCorrect).length;
      console.log(`${right}/${FIELDS.length} fields${allValueCorrect ? " ✓" : ""}`);
    } catch (err) {
      perLabel.push({ file, error: String(err.message || err) });
      console.log(`ERROR — ${err.message || err}`);
    }
  }

  // aggregate
  const perField = {};
  for (const key of FIELDS) perField[key] = { valueCorrect: 0, foundCorrect: 0, total: 0 };
  let fieldsCorrect = 0;
  let fieldsTotal = 0;
  let labelsExact = 0;
  const scoredLabels = perLabel.filter((l) => !l.error);
  for (const l of scoredLabels) {
    if (l.allValueCorrect) labelsExact++;
    for (const key of FIELDS) {
      const f = l.fields[key];
      perField[key].total++;
      fieldsTotal++;
      if (f.valueCorrect) {
        perField[key].valueCorrect++;
        fieldsCorrect++;
      }
      if (f.foundCorrect) perField[key].foundCorrect++;
    }
  }
  const pct = (n, d) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);

  const summary = {
    labelsTotal: files.length,
    labelsScored: scoredLabels.length,
    labelsExact,
    fieldsCorrect,
    fieldsTotal,
    fieldAccuracy: pct(fieldsCorrect, fieldsTotal),
    perField: Object.fromEntries(
      FIELDS.map((k) => [
        k,
        {
          valueAccuracy: pct(perField[k].valueCorrect, perField[k].total),
          foundAccuracy: pct(perField[k].foundCorrect, perField[k].total),
        },
      ]),
    ),
  };

  console.log("\nPer-field transcription accuracy:");
  for (const key of FIELDS) {
    console.log(`  ${key.padEnd(22)} ${String(summary.perField[key].valueAccuracy).padStart(5)}%`);
  }
  console.log(
    `\nOverall: ${fieldsCorrect}/${fieldsTotal} fields correct (${summary.fieldAccuracy}%) · ` +
      `${labelsExact}/${scoredLabels.length} labels fully correct`,
  );

  const results = { ranAt: new Date().toISOString(), base: BASE, model, summary, perLabel };
  await writeFile(join(__dirname, "results.json"), JSON.stringify(results, null, 2));
  console.log(`\nWrote eval/results.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
