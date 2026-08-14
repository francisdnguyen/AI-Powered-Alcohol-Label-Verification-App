/**
 * Browser-side image downscaling, used before a batch upload.
 *
 * Two hard Vercel limits shape the batch pipeline: a request body is capped at ~4.5 MB, and a
 * serverless function at 60s. Real phone photos (several MB each) blow the body limit almost
 * immediately, so we shrink each image in the browser before it ever hits the network. Labels are
 * mostly text, so a ~1280px JPEG is still comfortably legible to the vision model while landing
 * around 100-250 KB -- small enough that ~20 fit in one sub-4.5 MB chunk, which is what makes a
 * 200-300 file batch reachable within the per-IP request budget.
 *
 * The server still re-normalizes every image with sharp (orientation, format), so this is a
 * transport optimization, not the source of truth.
 */

/** Longest-edge target in pixels. Enough for label text; keeps files small. */
const MAX_EDGE = 1280;
/** JPEG quality for the re-encode. 0.72 is visually clean for text at this resolution. */
const JPEG_QUALITY = 0.72;
/** Below this, downscaling isn't worth the re-encode; send the original. */
const SKIP_UNDER_BYTES = 200 * 1024;

/**
 * Downscale one image to a smaller JPEG. Returns a new File, or the original untouched if it's
 * already small, isn't a raster image we can decode, or the re-encode somehow came out larger.
 * Never throws -- on any failure it falls back to the original file so the upload still proceeds.
 */
export async function downscaleImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  if (file.size <= SKIP_UNDER_BYTES) return file;
  // Animated GIFs would lose their frames through a canvas; leave them alone (they're rare here).
  if (file.type === "image/gif") return file;

  try {
    // `imageOrientation: "from-image"` bakes in EXIF rotation so portrait phone photos aren't
    // silently sent sideways.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", JPEG_QUALITY),
    );
    if (!blob || blob.size >= file.size) return file;

    return new File([blob], file.name, { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  }
}

/**
 * Split files into chunks that each stay under both a byte budget and a count cap, so every chunk
 * is a valid single request (under Vercel's ~4.5 MB body limit and the server's per-request file
 * cap). A single file larger than `maxBytes` still gets its own chunk rather than being dropped.
 */
export function chunkFiles(
  files: File[],
  maxBytes: number,
  maxCount: number,
): File[][] {
  const chunks: File[][] = [];
  let current: File[] = [];
  let currentBytes = 0;

  for (const file of files) {
    const wouldExceedBytes = currentBytes + file.size > maxBytes && current.length > 0;
    const wouldExceedCount = current.length >= maxCount;
    if (wouldExceedBytes || wouldExceedCount) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(file);
    currentBytes += file.size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
