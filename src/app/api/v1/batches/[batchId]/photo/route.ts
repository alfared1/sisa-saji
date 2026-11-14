import { connection } from "next/server";
import { getDb } from "@/db";
import { getSessionUser } from "@/server/auth/session";
import { ApiError, handle, parseUuid } from "@/server/http";
import {
  canViewBatchPhoto,
  photoCacheControl,
  photoVisibility,
  readBatchPhotoBytes,
  readBatchPhotoMeta,
} from "@/server/services/batch-photos";

type Ctx = { params: Promise<{ batchId: string }> };

/** One message for "never existed", "not for you" and "ended", so photos cannot be probed. */
const notAvailable = () => new ApiError("NOT_FOUND", "Foto tidak tersedia");

/**
 * GET /api/v1/batches/:batchId/photo?v=<version> — public, the image bytes of tonight's batch
 * photo. Checked on every read (batch-photos.ts): pilot warung photos are public, demo-account
 * photos only reach demo sessions and the owner within their hour, any other warung's photo
 * only its owner; the batch must still be live. Under /api/, so the service worker never
 * caches it. Cache-Control: public for pilot photos (the URL carries ?v=), otherwise
 * private, no-store.
 */
export const GET = handle<Ctx>(async (_req, { params }) => {
  await connection();
  const { batchId: raw } = await params;
  let batchId: string;
  try {
    batchId = parseUuid(raw);
  } catch {
    throw notAvailable();
  }

  const db = getDb();
  // Metadata first: the bytes are only read once the viewer is allowed to see them.
  const photo = await readBatchPhotoMeta(db, batchId);
  if (!photo) throw notAvailable();

  const viewer = await getSessionUser();
  const allowed = canViewBatchPhoto(
    photo,
    { isDemo: viewer?.is_demo === true, ownsMerchant: viewer !== null && viewer.id === photo.merchantOwnerUserId },
    new Date(),
  );
  if (!allowed) throw notAvailable();
  const bytes = await readBatchPhotoBytes(db, batchId, photo.photoId);
  if (!bytes) throw notAvailable();

  const body = new Uint8Array(bytes);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": photo.contentType,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": "inline",
      "Cache-Control": photoCacheControl(photoVisibility(photo)),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
});
