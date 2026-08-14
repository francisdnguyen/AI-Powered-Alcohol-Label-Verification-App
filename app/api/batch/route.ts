import { NextResponse } from "next/server";
import { ALLOWED_MIME, MAX_UPLOAD_BYTES } from "@/lib/image";
import {
  processBatch,
  MAX_BATCH_FILES,
  type BatchInput,
  type BatchFileResult,
} from "@/lib/batch";
import { getApplication } from "@/lib/applications";
import type { ApplicationData } from "@/lib/matcher";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Analyze one chunk of labels and return every per-file result inline. The client splits a large
 * upload into chunks (each within the ~4.5MB body limit and this MAX_BATCH_FILES cap) and merges
 * the responses. Synchronous on purpose: it keeps all state inside one invocation, avoiding the
 * per-instance in-memory job store that made an earlier poll-based design 404 on Vercel.
 */
export async function POST(request: Request) {
  const rl = checkRateLimit(getClientIp(request));
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 60) } },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected a form upload." }, { status: 400 });
  }

  const files = form.getAll("images").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json(
      { error: "Add at least one label photo to run a batch." },
      { status: 400 },
    );
  }
  if (files.length > MAX_BATCH_FILES) {
    return NextResponse.json(
      { error: `Too many files. Upload at most ${MAX_BATCH_FILES} at a time.` },
      { status: 400 },
    );
  }

  // Expected values: self-check, or one application matched against every file.
  const mode = form.get("mode");
  if (mode !== "self" && mode !== "application") {
    return NextResponse.json({ error: "Choose a batch mode." }, { status: 400 });
  }

  let expected: ApplicationData | null = null;
  if (mode === "application") {
    const id = form.get("applicationId");
    if (typeof id !== "string" || id === "") {
      return NextResponse.json({ error: "Select an application to match." }, { status: 400 });
    }
    const app = getApplication(id);
    if (!app) {
      return NextResponse.json({ error: "That application was not found." }, { status: 404 });
    }
    expected = {
      brandName: app.brandName,
      classType: app.classType,
      alcoholContent: app.alcoholContent,
      netContents: app.netContents,
      producerNameAddress: app.producerNameAddress,
      countryOfOrigin: app.countryOfOrigin,
    };
  }

  // Validate per file: an invalid file (bad MIME / oversized) gets an inline error result so it
  // never fails the other labels in the same chunk. Valid files are analyzed and merged back by
  // their original position.
  const results: BatchFileResult[] = new Array(files.length);
  const inputs: BatchInput[] = [];
  const inputPositions: number[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (!ALLOWED_MIME.has(f.type)) {
      results[i] = {
        index: i,
        filename: f.name,
        status: "error",
        error: `"${f.name}" is not a supported image (use JPEG, PNG, or WebP).`,
      };
    } else if (f.size > MAX_UPLOAD_BYTES) {
      results[i] = {
        index: i,
        filename: f.name,
        status: "error",
        error: `"${f.name}" is too large (max 8 MB each).`,
      };
    } else {
      inputs.push({ buffer: Buffer.from(await f.arrayBuffer()), filename: f.name });
      inputPositions.push(i);
    }
  }

  const processed = await processBatch(inputs, expected);
  processed.forEach((r, k) => {
    results[inputPositions[k]] = { ...r, index: inputPositions[k] };
  });

  return NextResponse.json({ files: results, total: results.length });
}
