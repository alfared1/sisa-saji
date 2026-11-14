/**
 * Server-side checks for uploaded batch photos. Only JPEG is accepted: the merchant app
 * always re-encodes the camera photo to JPEG (which also strips EXIF/GPS), so PNG, WebP,
 * SVG, HEIC and anything else is refused. The declared pixel size is read from the JPEG
 * frame header (SOFn) so a small file cannot declare a huge canvas that freezes phones.
 */
import { BATCH_PHOTO_MAX_DIMENSION_PX, BATCH_PHOTO_MAX_PIXELS } from "@/lib/constants";

export type SniffedImageType = "image/jpeg";

/** "image/jpeg" when the bytes start with the JPEG SOI marker (FF D8 FF), else null. */
export function sniffImageType(bytes: Uint8Array): SniffedImageType | null {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? "image/jpeg" : null;
}

/** SOFn markers that carry the frame size (C4 DHT, C8 JPG and CC DAC are not frames). */
const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/**
 * Width and height from the first JPEG frame header, or null when the file is not a JPEG,
 * is cut off before a frame header, or declares a zero size.
 */
export function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (!sniffImageType(bytes)) return null;
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    // Fill bytes: any number of 0xFF before a marker.
    while (i < bytes.length && bytes[i] === 0xff) i++;
    if (i >= bytes.length) return null;
    const marker = bytes[i];
    i++;
    // Markers without a length: TEM, RST0-7, SOI.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    // End of image or start of scan before any frame header: no size.
    if (marker === 0xd9 || marker === 0xda) return null;
    if (i + 1 >= bytes.length) return null;
    const length = (bytes[i] << 8) | bytes[i + 1];
    if (length < 2) return null;
    if (SOF_MARKERS.has(marker)) {
      if (length < 7 || i + 6 >= bytes.length) return null;
      const height = (bytes[i + 3] << 8) | bytes[i + 4];
      const width = (bytes[i + 5] << 8) | bytes[i + 6];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    i += length;
  }
  return null;
}

export type ImageInspection =
  | { ok: true; contentType: SniffedImageType; width: number; height: number }
  | { ok: false; reason: "type" | "dimensions" };

/**
 * Accepts a JPEG whose frame is at most BATCH_PHOTO_MAX_DIMENSION_PX on each edge and
 * BATCH_PHOTO_MAX_PIXELS in total. A JPEG without a readable frame header counts as a wrong
 * type (it cannot be shown either).
 */
export function inspectImage(bytes: Uint8Array): ImageInspection {
  const size = jpegDimensions(bytes);
  if (!size) return { ok: false, reason: "type" };
  if (
    size.width > BATCH_PHOTO_MAX_DIMENSION_PX ||
    size.height > BATCH_PHOTO_MAX_DIMENSION_PX ||
    size.width * size.height > BATCH_PHOTO_MAX_PIXELS
  ) {
    return { ok: false, reason: "dimensions" };
  }
  return { ok: true, contentType: "image/jpeg", ...size };
}
