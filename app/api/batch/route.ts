import { NextResponse } from "next/server";
import { ALLOWED_MIME, MAX_UPLOAD_BYTES } from "@/lib/image";
import {
  createJob,
  MAX_BATCH_FILES,
  type BatchInput,
} from "@/lib/batch";
import { getApplication } from "@/lib/applications";
import type { ApplicationData } from "@/lib/matcher";
import { getBudgetStatus } from "@/lib/budget";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Start a batch analysis job. Returns a job id the client polls. */
export async function POST(request: Request) {
  const rl = checkRateLimit(getClientIp(request));
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 60) } },
    );
  }

  if (getBudgetStatus().exhausted) {
    return NextResponse.json(
      { error: "The analysis budget has been reached; no new batches can run." },
      { status: 402 },
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
  for (const f of files) {
    if (!ALLOWED_MIME.has(f.type)) {
      return NextResponse.json(
        { error: `"${f.name}" is not a supported image (use JPEG, PNG, or WebP).` },
        { status: 415 },
      );
    }
    if (f.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `"${f.name}" is too large (max 8 MB each).` },
        { status: 413 },
      );
    }
  }

  // Expected values: self-check, or one application matched against every file.
  const mode = form.get("mode");
  if (mode !== "self" && mode !== "application") {
    return NextResponse.json({ error: "Choose a batch mode." }, { status: 400 });
  }

  let expected: ApplicationData | null = null;
  let applicationId: string | undefined;
  if (mode === "application") {
    const id = form.get("applicationId");
    if (typeof id !== "string" || id === "") {
      return NextResponse.json({ error: "Select an application to match." }, { status: 400 });
    }
    const app = getApplication(id);
    if (!app) {
      return NextResponse.json({ error: "That application was not found." }, { status: 404 });
    }
    applicationId = app.id;
    expected = {
      brandName: app.brandName,
      classType: app.classType,
      alcoholContent: app.alcoholContent,
      netContents: app.netContents,
      producerNameAddress: app.producerNameAddress,
      countryOfOrigin: app.countryOfOrigin,
    };
  }

  const inputs: BatchInput[] = [];
  for (const f of files) {
    inputs.push({ buffer: Buffer.from(await f.arrayBuffer()), filename: f.name });
  }

  const job = createJob(inputs, mode, expected, applicationId);
  return NextResponse.json({ jobId: job.id, total: job.total });
}
