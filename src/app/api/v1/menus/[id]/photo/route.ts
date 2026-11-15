import { connection } from "next/server";
import { getDb } from "@/db";
import { getSessionUser } from "@/server/auth/session";
import { ApiError, handle, parseUuid } from "@/server/http";
import { readMenuPhotoBytes, readMenuPhotoMeta } from "@/server/services/merchant/menu-photos";

type Ctx = { params: Promise<{ id: string }> };

/** One message for "never existed" and "not for you", so photos cannot be probed. */
const notAvailable = () => new ApiError("NOT_FOUND", "Foto tidak tersedia");

/**
 * GET /api/v1/menus/:id/photo?v=<version> — the image bytes of a menu's photo. Field pilot
 * warung: public (cacheable, the URL carries ?v=). Any other warung: only its owner, as a
 * preview (private, no-store). Same rule as batch photos.
 */
export const GET = handle<Ctx>(async (_req, { params }) => {
  await connection();
  let menuId: string;
  try {
    menuId = parseUuid((await params).id);
  } catch {
    throw notAvailable();
  }
  const db = getDb();
  const meta = await readMenuPhotoMeta(db, menuId);
  if (!meta) throw notAvailable();
  if (!meta.merchantIsPilot) {
    const viewer = await getSessionUser();
    if (!viewer || viewer.id !== meta.ownerUserId) throw notAvailable();
  }
  const bytes = await readMenuPhotoBytes(db, menuId, meta.photoId);
  if (!bytes) throw notAvailable();
  const body = new Uint8Array(bytes);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": meta.contentType,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": "inline",
      "Cache-Control": meta.merchantIsPilot ? "public, max-age=3600" : "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
});
