import { NextResponse } from "next/server";
import { normalizeImage, ALLOWED_MIME, MAX_UPLOAD_BYTES } from "@/lib/image";
import {
  extractLabel,
  DEFAULT_MODEL,
  MissingApiKeyError,
  ExtractionError,
} from "@/lib/anthropic";
import { BudgetExceededError } from "@/lib/budget";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import {
  reviewLabel,
  type ApplicationData,
  type ReviewMode,
  type ReviewResponse,
} from "@/lib/matcher";
import { getApplication } from "@/lib/applications";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Manual free-text fields are capped server-side; the browser is untrusted. */
const MAX_FIELD_LEN = 300;
const MANUAL_KEYS = [
  "brandName",
  "classType",
  "alcoholContent",
  "netContents",
  "producerNameAddress",
  "countryOfOrigin",
] as const;

function readField(form: FormData, key: string): string | null | { tooLong: true } {
  const raw = form.get(key);
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (trimmed.length > MAX_FIELD_LEN) return { tooLong: true };
  return trimmed;
}

export async function POST(request: Request) {
  const startedAt = Date.now();

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

  // --- image ---
  const file = form.get("image");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "No image file was provided. Please attach a label photo." },
      { status: 400 },
    );
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported image type "${file.type || "unknown"}". Use JPEG, PNG, or WebP.` },
      { status: 415 },
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "That image is too large. Please use one under 8 MB." },
      { status: 413 },
    );
  }

  // --- mode + expected values ---
  const mode = form.get("mode");
  if (mode !== "application" && mode !== "manual" && mode !== "self") {
    return NextResponse.json(
      { error: "Choose what to check the label against." },
      { status: 400 },
    );
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
  } else if (mode === "manual") {
    const collected: ApplicationData = {};
    for (const key of MANUAL_KEYS) {
      const v = readField(form, key);
      if (v && typeof v === "object" && "tooLong" in v) {
        return NextResponse.json(
          { error: `The "${key}" value is too long (max ${MAX_FIELD_LEN} characters).` },
          { status: 400 },
        );
      }
      collected[key] = v;
    }
    expected = collected;
  }
  // mode === "self" => expected stays null

  // --- run the pipeline ---
  try {
    const buffer = Buffer.from(await file.arrayBuffer());

    const imgStart = Date.now();
    let normalized;
    try {
      normalized = await normalizeImage(buffer);
    } catch {
      return NextResponse.json(
        { error: "We couldn't read that file as an image. Try re-taking or re-saving the photo." },
        { status: 400 },
      );
    }
    const imageMs = Date.now() - imgStart;

    const aiStart = Date.now();
    const extracted = await extractLabel(normalized);
    const aiMs = Date.now() - aiStart;

    const review = reviewLabel(extracted, expected);

    const body: ReviewResponse = {
      extracted,
      review,
      timing: { imageMs, aiMs, totalMs: Date.now() - startedAt },
      model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      mode: mode as ReviewMode,
      applicationId,
    };
    return NextResponse.json(body);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return NextResponse.json({ error: err.message }, { status: 402 });
    }
    if (err instanceof MissingApiKeyError) {
      return NextResponse.json(
        { error: "The server is not configured with an API key yet." },
        { status: 503 },
      );
    }
    if (err instanceof ExtractionError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    console.error("[/api/review] unexpected error:", err);
    return NextResponse.json(
      { error: "Something went wrong while analyzing the label." },
      { status: 500 },
    );
  }
}
