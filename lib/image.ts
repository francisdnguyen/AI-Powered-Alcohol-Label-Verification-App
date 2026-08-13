import sharp from "sharp";

/** Accepted upload types. Kept small and explicit — the browser is untrusted. */
export const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/** Hard cap on the raw upload before we downscale (defense-in-depth vs. huge payloads). */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB

/**
 * Claude vision works best when the longest edge is ~1568px; larger images cost
 * latency without accuracy gains. We also auto-rotate via EXIF so photos taken
 * sideways are read upright (Jenny's "handle imperfect photos" need).
 */
const MAX_EDGE = 1568;
const JPEG_QUALITY = 82;

export interface NormalizedImage {
  base64: string;
  mediaType: "image/jpeg";
  width: number;
  height: number;
}

/**
 * Normalize an arbitrary uploaded image into a compact, upright JPEG suitable for
 * the vision model. Throws on data that isn't a decodable image.
 */
export async function normalizeImage(input: Buffer): Promise<NormalizedImage> {
  const { data, info } = await sharp(input, { failOn: "error" })
    .rotate() // apply EXIF orientation, then strip it
    .resize({
      width: MAX_EDGE,
      height: MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer({ resolveWithObject: true });

  return {
    base64: data.toString("base64"),
    mediaType: "image/jpeg",
    width: info.width,
    height: info.height,
  };
}
