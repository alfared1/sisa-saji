/**
 * Menu photos: the warung's own photo of a menu, kept across nights (unlike tonight's batch
 * photo). Bytes live in Postgres (menu_photos.bytes) and are only read by the photo GET route.
 *
 *   upload     = owner only, raw JPEG (compressed on the phone, sniffed and size-checked by
 *                readImageBody), one photo per menu, replaced on upload. Counts towards the
 *                warung's hourly photo limit together with batch photos. The shared demo warung
 *                is locked (its menus are), see the route.
 *   visibility = the same rule as batch photos: buyers see it for field pilot warung; for any
 *                other warung it is a preview only its owner sees. Discovery already only sends
 *                image_url for pilot warung.
 *   url        = menus.image_url = /api/v1/menus/:id/photo?v=<version>.
 */
import "server-only";
import { and, eq, gt, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { batchPhotoUploads, menuPhotos, menus, merchants } from "@/db/schema";
import { BATCH_PHOTO_MAX_UPLOADS_PER_HOUR } from "@/lib/constants";
import type { MenuView } from "@/lib/contracts";
import { ApiError } from "@/server/http";
import { getOwnedMenu } from "./menus";
import { toMenuView } from "./views";

const HOUR_MS = 60 * 60_000;

export function menuPhotoUrl(menuId: string, version: string): string {
  return `/api/v1/menus/${menuId}/photo?v=${version}`;
}

/** True when image_url is one of our stored photos (not an external URL set by the API). */
function isStoredPhotoUrl(menuId: string, url: string | null): boolean {
  return Boolean(url?.startsWith(`/api/v1/menus/${menuId}/photo`));
}

export async function uploadMenuPhoto(
  db: Db,
  merchantId: string,
  menuId: string,
  photo: { bytes: Buffer; contentType: string },
  now: Date = new Date(),
): Promise<MenuView> {
  await getOwnedMenu(db, merchantId, menuId);
  const updated = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('batch_photo_upload'), hashtext(${merchantId}))`);
    const [recent] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(batchPhotoUploads)
      .where(and(eq(batchPhotoUploads.merchantId, merchantId), gt(batchPhotoUploads.createdAt, new Date(now.getTime() - HOUR_MS))));
    if ((recent?.n ?? 0) >= BATCH_PHOTO_MAX_UPLOADS_PER_HOUR) {
      throw new ApiError("RATE_LIMITED", `Paling banyak ${BATCH_PHOTO_MAX_UPLOADS_PER_HOUR} foto per jam. Coba lagi nanti.`);
    }
    const version = crypto.randomUUID();
    await tx
      .insert(menuPhotos)
      .values({
        menuId,
        id: version,
        merchantId,
        bytes: photo.bytes,
        contentType: photo.contentType,
        byteSize: photo.bytes.byteLength,
        uploadedAt: now,
      })
      .onConflictDoUpdate({
        target: menuPhotos.menuId,
        set: { id: version, bytes: photo.bytes, contentType: photo.contentType, byteSize: photo.bytes.byteLength, uploadedAt: now },
      });
    await tx.insert(batchPhotoUploads).values({ merchantId, createdAt: now });
    const [m] = await tx
      .update(menus)
      .set({ imageUrl: menuPhotoUrl(menuId, version), updatedAt: now })
      .where(and(eq(menus.id, menuId), eq(menus.merchantId, merchantId)))
      .returning();
    return m;
  });
  return toMenuView(updated);
}

export async function removeMenuPhoto(db: Db, merchantId: string, menuId: string, now: Date = new Date()): Promise<MenuView> {
  const menu = await getOwnedMenu(db, merchantId, menuId);
  const updated = await db.transaction(async (tx) => {
    await tx.delete(menuPhotos).where(eq(menuPhotos.menuId, menuId));
    if (!isStoredPhotoUrl(menuId, menu.imageUrl)) return menu;
    const [m] = await tx.update(menus).set({ imageUrl: null, updatedAt: now }).where(eq(menus.id, menuId)).returning();
    return m;
  });
  return toMenuView(updated);
}

export type StoredMenuPhoto = { photoId: string; contentType: string; merchantIsPilot: boolean; ownerUserId: string };

/** Metadata only (never the bytes), for the visibility check. */
export async function readMenuPhotoMeta(db: Db, menuId: string): Promise<StoredMenuPhoto | null> {
  const [row] = await db
    .select({
      photoId: menuPhotos.id,
      contentType: menuPhotos.contentType,
      merchantIsPilot: merchants.isPilot,
      ownerUserId: merchants.ownerUserId,
    })
    .from(menuPhotos)
    .innerJoin(merchants, eq(merchants.id, menuPhotos.merchantId))
    .where(eq(menuPhotos.menuId, menuId))
    .limit(1);
  return row ?? null;
}

export async function readMenuPhotoBytes(db: Db, menuId: string, photoId: string): Promise<Buffer | null> {
  const [row] = await db
    .select({ bytes: menuPhotos.bytes })
    .from(menuPhotos)
    .where(and(eq(menuPhotos.menuId, menuId), eq(menuPhotos.id, photoId)))
    .limit(1);
  return row?.bytes ?? null;
}
