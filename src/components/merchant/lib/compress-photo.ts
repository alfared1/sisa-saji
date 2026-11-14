/**
 * Client-side photo compression for "Foto etalase malam ini". The camera photo is decoded
 * (rotated upright from its EXIF orientation), scaled so the long edge is at most
 * BATCH_PHOTO_MAX_EDGE_PX and re-encoded as JPEG, lowering the quality until it fits
 * BATCH_PHOTO_TARGET_BYTES. Re-encoding through a canvas drops EXIF, including GPS.
 * The server accepts JPEG only, up to BATCH_PHOTO_MAX_BYTES.
 */
import { BATCH_PHOTO_MAX_BYTES, BATCH_PHOTO_MAX_EDGE_PX, BATCH_PHOTO_TARGET_BYTES } from "@/lib/constants";

/** JPEG qualities tried in order until the photo fits the target size. */
export const PHOTO_QUALITIES = [0.8, 0.7, 0.6, 0.5] as const;
/** Long edge for a last attempt when even the lowest quality is over the hard limit. */
const FALLBACK_EDGE_PX = 960;

export const PHOTO_TOO_LARGE_MESSAGE = "Foto terlalu besar. Coba foto ulang dari jarak lebih dekat.";
export const PHOTO_UNREADABLE_MESSAGE = "Foto tidak bisa dibaca. Coba ambil foto lagi dengan kamera.";

/** Size that fits `maxEdge` on the long side, keeping the aspect ratio (never upscales). */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge) return { width, height };
  const scale = maxEdge / longEdge;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * The encoding to keep from attempts made in PHOTO_QUALITIES order: the first one within
 * the target, else the smallest one within the hard limit, else null (too large).
 */
export function pickEncoding<T extends { size: number }>(attempts: readonly T[]): T | null {
  const fits = attempts.find((a) => a.size <= BATCH_PHOTO_TARGET_BYTES);
  if (fits) return fits;
  const allowed = attempts.filter((a) => a.size <= BATCH_PHOTO_MAX_BYTES);
  return allowed.length ? allowed.reduce((a, b) => (b.size < a.size ? b : a)) : null;
}

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(PHOTO_UNREADABLE_MESSAGE))), "image/jpeg", quality);
  });
}

async function encodeAtEdge(bitmap: ImageBitmap, maxEdge: number): Promise<Blob | null> {
  const size = fitWithin(bitmap.width, bitmap.height, maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(PHOTO_UNREADABLE_MESSAGE);
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  const attempts: Blob[] = [];
  for (const q of PHOTO_QUALITIES) {
    const blob = await encode(canvas, q);
    attempts.push(blob);
    if (blob.size <= BATCH_PHOTO_TARGET_BYTES) break;
  }
  return pickEncoding(attempts);
}

/** Compresses a picked or captured photo to a JPEG Blob ready for upload. Throws with Indonesian copy. */
export async function compressPhoto(file: Blob): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(PHOTO_UNREADABLE_MESSAGE);
  }
  try {
    const blob = (await encodeAtEdge(bitmap, BATCH_PHOTO_MAX_EDGE_PX)) ?? (await encodeAtEdge(bitmap, FALLBACK_EDGE_PX));
    if (!blob) throw new Error(PHOTO_TOO_LARGE_MESSAGE);
    return blob;
  } finally {
    bitmap.close();
  }
}
