import { NextResponse } from "next/server";
import { normalizeImage, ALLOWED_MIME, MAX_UPLOAD_BYTES } from "@/lib/image";
import {
  extractLabel,
  DEFAULT_MODEL,
  MissingApiKeyError,
  ExtractionError,
} from "@/lib/anthropic";
import type { ExtractResponse } from "@/lib/schema";

// sharp + the Anthropic SDK need the Node.js runtime (not Edge).
export const runtime = "nodejs";
// Generous ceiling; the label call itself targets < 5s.
export const maxDuration = 30;

export async function POST(request: Request) {
  const startedAt = Date.now();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected a multipart form upload." },
      { status: 400 },
    );
  }

  const file = form.get("image");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "No image file was provided. Please attach a label photo." },
      { status: 400 },
    );
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      {
        error: `Unsupported image type "${file.type || "unknown"}". Use JPEG, PNG, or WebP.`,
      },
      { status: 415 },
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "That image is too large. Please use one under 8 MB." },
      { status: 413 },
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());

    const imgStart = Date.now();
    let normalized;
    try {
      normalized = await normalizeImage(buffer);
    } catch {
      return NextResponse.json(
        {
          error:
            "We couldn't read that file as an image. Try re-taking or re-saving the photo.",
        },
        { status: 400 },
      );
    }
    const imageMs = Date.now() - imgStart;

    const aiStart = Date.now();
    const fields = await extractLabel(normalized);
    const aiMs = Date.now() - aiStart;

    const body: ExtractResponse = {
      fields,
      timing: { imageMs, aiMs, totalMs: Date.now() - startedAt },
      model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
    };
    return NextResponse.json(body);
  } catch (err) {
    if (err instanceof MissingApiKeyError) {
      return NextResponse.json(
        { error: "Server is not configured with an API key." },
        { status: 503 },
      );
    }
    if (err instanceof ExtractionError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    console.error("[/api/extract] unexpected error:", err);
    return NextResponse.json(
      { error: "Something went wrong while analyzing the label." },
      { status: 500 },
    );
  }
}
