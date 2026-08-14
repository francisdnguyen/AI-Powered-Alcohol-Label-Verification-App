import sharp, { type Sharp } from "sharp";

/** Accepted upload types. Kept small and explicit — the browser is untrusted. */
export const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/** Hard cap on the raw upload before we downscale (defense-in-depth vs. huge payloads). */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB

/**
 * Claude vision downsamples anything larger than ~1568px on the long edge, so a single big label
 * photo loses the fine print (the government warning) in that downsample. We handle image quality
 * in three bands, inspired by a peer implementation:
 *   - very small (<0.5 MP): upscale toward ~1 MP with a good kernel + light sharpen, so faint tiny
 *     text becomes legible instead of blurry.
 *   - large (long edge > ~2352px): split the longer axis into two overlapping halves and normalize
 *     each at full 1568px, preserving small text at ~2x the resolution a single downscale would keep.
 *   - normal: a single compact, upright JPEG (the original behavior).
 * EXIF rotation is always baked in first so sideways phone photos are read upright.
 */
const MAX_EDGE = 1568;
const JPEG_QUALITY = 82;
// Only tile when the long edge is well beyond MAX_EDGE — i.e. a single normalize would actually
// downscale and lose fine text. Below this, tiling just doubles cost for no detail gain.
const TILE_MIN_LONG_EDGE = Math.round(MAX_EDGE * 1.5); // ~2352px
const SMALL_PIXELS = 500_000; // < 0.5 MP → upscale toward ~1 MP
const UPSCALE_TARGET_PIXELS = 1_000_000;
const TILE_OVERLAP_FRACTION = 0.12; // overlap along the split axis so a line on the seam isn't cut

export interface NormalizedImage {
  base64: string;
  mediaType: "image/jpeg";
  width: number;
  height: number;
}

const RESIZE_FIT = {
  width: MAX_EDGE,
  height: MAX_EDGE,
  fit: "inside" as const,
  withoutEnlargement: true,
};

async function toNormalizedJpeg(pipeline: Sharp): Promise<NormalizedImage> {
  const { data, info } = await pipeline
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer({ resolveWithObject: true });
  return {
    base64: data.toString("base64"),
    mediaType: "image/jpeg",
    width: info.width,
    height: info.height,
  };
}

/**
 * Normalize an uploaded image into one or two compact, upright JPEGs suitable for the vision model.
 * Returns an array: one image for the normal/small case, two overlapping vertical tiles for large
 * images. Throws on data that isn't a decodable image.
 */
export async function prepareImages(input: Buffer): Promise<NormalizedImage[]> {
  // Bake EXIF orientation into a buffer so width/height are unambiguous for every step below.
  const baked = await sharp(input, { failOn: "error" }).rotate().toBuffer();
  const meta = await sharp(baked).metadata();
  const srcW = meta.width ?? 0;
  const srcH = meta.height ?? 0;
  const pixels = srcW * srcH;

  // Very small: upscale toward ~1 MP so fine print is larger for the model to read.
  if (pixels > 0 && pixels < SMALL_PIXELS) {
    const scale = Math.sqrt(UPSCALE_TARGET_PIXELS / pixels);
    const w = Math.max(1, Math.round(srcW * scale));
    const h = Math.max(1, Math.round(srcH * scale));
    return [await toNormalizedJpeg(sharp(baked).resize(w, h, { kernel: "lanczos3" }).sharpen())];
  }

  // Large: split the longer axis into two overlapping halves, each normalized at full resolution,
  // so fine text survives at ~2x the detail a single downscale would keep.
  if (Math.max(srcW, srcH) > TILE_MIN_LONG_EDGE && srcW > 1 && srcH > 1) {
    const vertical = srcH >= srcW; // split the longer dimension
    const axisLen = vertical ? srcH : srcW;
    const overlap = Math.round(axisLen * TILE_OVERLAP_FRACTION);
    const half = Math.ceil(axisLen / 2);
    const firstLen = Math.min(axisLen, half + overlap);
    const secondStart = Math.max(0, axisLen - (half + overlap));
    const secondLen = axisLen - secondStart;
    const tile = (start: number, len: number) =>
      vertical
        ? sharp(baked).extract({ left: 0, top: start, width: srcW, height: len }).resize(RESIZE_FIT)
        : sharp(baked).extract({ left: start, top: 0, width: len, height: srcH }).resize(RESIZE_FIT);
    const [first, second] = await Promise.all([
      toNormalizedJpeg(tile(0, firstLen)),
      toNormalizedJpeg(tile(secondStart, secondLen)),
    ]);
    return [first, second];
  }

  // Normal range: a single compact, upright JPEG.
  return [await toNormalizedJpeg(sharp(baked).resize(RESIZE_FIT))];
}
