/**
 * Batch photos ("Foto etalase malam ini"): storage, the visibility rule, upload limits and
 * the purge. Bytes live in Postgres (batch_photos.bytes) and are only read by the photo GET
 * route; every listing uses the meta helpers here, which never select the bytes.
 *
 * Visibility is decided on every read, from the merchant and the uploader:
 *  - PUBLIC: the warung is in the field pilot (merchants.is_pilot) → everyone ("Foto asli").
 *  - DEMO: uploaded by a shared demo account (demo_only) → demo sessions and the owner, for
 *    DEMO_BATCH_PHOTO_TTL_MINUTES after upload ("Foto contoh akun demo").
 *  - OWNER: any other warung (self-registered or seed) → only the owning warung, as a preview.
 * In every case the batch must still be live: ACTIVE/SCHEDULED/SOLD_OUT and before its
 * pickup_end_time.
 */
import "server-only";
import { and, eq, gt, inArray, sql, type SQL } from "drizzle-orm";
import type { Db, DbOrTx } from "@/db/client";
import { batchPhotos, batchPhotoUploads, merchants, surplusBatches } from "@/db/schema";
import {
  BATCH_PHOTO_MAX_UPLOADS,
  BATCH_PHOTO_MAX_UPLOADS_PER_HOUR,
  DEMO_BATCH_PHOTO_MAX_LIVE,
  DEMO_BATCH_PHOTO_TTL_MINUTES,
} from "@/lib/constants";
import type {
  BatchPhotoMeta,
  BatchPhotoResponse,
  BatchPhotoVisibility,
  BatchStatus,
  MerchantBatchPhoto,
} from "@/lib/contracts";
import { ApiError } from "@/server/http";

export const PHOTO_LIVE_STATUSES = ["ACTIVE", "SOLD_OUT", "SCHEDULED"] as const satisfies readonly BatchStatus[];

const MINUTE_MS = 60_000;
const DEMO_TTL_MS = DEMO_BATCH_PHOTO_TTL_MINUTES * MINUTE_MS;
/** Upload log rows older than this are pruned by the purge (the limit only looks back one hour). */
const UPLOAD_LOG_RETENTION_MS = 24 * 60 * MINUTE_MS;

/* ------------------------------------------------------------------ */
/* Pure rules                                                          */
/* ------------------------------------------------------------------ */

export function photoVisibility(meta: { demoOnly: boolean; merchantIsPilot: boolean }): BatchPhotoVisibility {
  if (meta.demoOnly) return "DEMO";
  return meta.merchantIsPilot ? "PUBLIC" : "OWNER";
}

/** When a demo-account photo stops being shown. */
export function demoPhotoExpiresAt(uploadedAt: Date): Date {
  return new Date(uploadedAt.getTime() + DEMO_TTL_MS);
}

export function isPhotoBatchLive(batchStatus: BatchStatus, pickupEndTime: Date, now: Date): boolean {
  return (PHOTO_LIVE_STATUSES as readonly BatchStatus[]).includes(batchStatus) && pickupEndTime.getTime() > now.getTime();
}

export function canViewBatchPhoto(
  meta: { demoOnly: boolean; uploadedAt: Date; batchStatus: BatchStatus; pickupEndTime: Date; merchantIsPilot: boolean },
  viewer: { isDemo: boolean; ownsMerchant: boolean },
  now: Date,
): boolean {
  if (!isPhotoBatchLive(meta.batchStatus, meta.pickupEndTime, now)) return false;
  switch (photoVisibility(meta)) {
    case "PUBLIC":
      return true;
    case "DEMO":
      return demoPhotoExpiresAt(meta.uploadedAt).getTime() > now.getTime() && (viewer.isDemo || viewer.ownsMerchant);
    case "OWNER":
      return viewer.ownsMerchant;
  }
}

/** Cache-Control for the photo GET: shared caching only for public photos (the URL carries ?v=). */
export function photoCacheControl(visibility: BatchPhotoVisibility): string {
  return visibility === "PUBLIC" ? "public, max-age=3600" : "private, no-store";
}

export function batchPhotoUrl(batchId: string, photoId: string): string {
  return `/api/v1/batches/${batchId}/photo?v=${photoId}`;
}

export function photoUploadsLeft(photoUploadCount: number): number {
  return Math.max(0, BATCH_PHOTO_MAX_UPLOADS - photoUploadCount);
}

/* ------------------------------------------------------------------ */
/* Discovery (buyer) meta, no bytes                                    */
/* ------------------------------------------------------------------ */

/**
 * LEFT JOIN of the buyer-visible photo for a discovery query that aliases surplus_batches as
 * `b` and merchants as `m`. Applies the live, pilot, demo_only and TTL rules in SQL; the
 * owner-only preview is never listed to buyers. Selects photo_id, photo_uploaded_at and
 * photo_demo_only (never the bytes); map a row with batchPhotoFromRow.
 */
export function photoMetaSql(opts: { viewerIsDemo: boolean; now: Date }): { select: SQL; join: SQL } {
  const demoSince = new Date(opts.now.getTime() - DEMO_TTL_MS);
  const visible = opts.viewerIsDemo
    ? sql`((NOT bp.demo_only AND m.is_pilot) OR (bp.demo_only AND bp.uploaded_at > ${demoSince}))`
    : sql`(NOT bp.demo_only AND m.is_pilot)`;
  return {
    select: sql`bp.id AS photo_id, bp.uploaded_at AS photo_uploaded_at, bp.demo_only AS photo_demo_only`,
    join: sql`LEFT JOIN batch_photos bp ON bp.surplus_batch_id = b.id
      AND b.status IN ('ACTIVE', 'SOLD_OUT', 'SCHEDULED')
      AND b.pickup_end_time > ${opts.now}
      AND ${visible}`,
  };
}

/** BatchCard.photo from a row selected with photoMetaSql. */
export function batchPhotoFromRow(row: {
  batch_id: string;
  photo_id: string | null;
  photo_uploaded_at: Date | string | null;
  photo_demo_only: boolean | null;
}): BatchPhotoMeta | null {
  if (!row.photo_id || !row.photo_uploaded_at) return null;
  return {
    url: batchPhotoUrl(row.batch_id, row.photo_id),
    uploaded_at: new Date(row.photo_uploaded_at).toISOString(),
    kind: row.photo_demo_only ? "demo" : "real",
  };
}

/* ------------------------------------------------------------------ */
/* Merchant meta, no bytes                                             */
/* ------------------------------------------------------------------ */

function toMerchantBatchPhoto(r: {
  batchId: string;
  photoId: string;
  uploadedAt: Date;
  demoOnly: boolean;
  merchantIsPilot: boolean;
}): MerchantBatchPhoto {
  const visibility = photoVisibility(r);
  return {
    url: batchPhotoUrl(r.batchId, r.photoId),
    uploaded_at: r.uploadedAt.toISOString(),
    visibility,
    demo_only: r.demoOnly,
    expires_at: visibility === "DEMO" ? demoPhotoExpiresAt(r.uploadedAt).toISOString() : null,
  };
}

/**
 * The owner's view of the photos of these batches (MerchantBatchView.photo), keyed by batch
 * id. Demo photos past their TTL are left out (the GET would refuse them too).
 */
export async function photoMetaForBatches(
  db: DbOrTx,
  batchIds: readonly string[],
  now: Date = new Date(),
): Promise<Map<string, MerchantBatchPhoto>> {
  const out = new Map<string, MerchantBatchPhoto>();
  if (batchIds.length === 0) return out;
  const rows = await db
    .select({
      batchId: batchPhotos.surplusBatchId,
      photoId: batchPhotos.id,
      uploadedAt: batchPhotos.uploadedAt,
      demoOnly: batchPhotos.demoOnly,
      merchantIsPilot: merchants.isPilot,
    })
    .from(batchPhotos)
    .innerJoin(merchants, eq(merchants.id, batchPhotos.merchantId))
    .where(inArray(batchPhotos.surplusBatchId, [...batchIds]));
  for (const r of rows) {
    if (r.demoOnly && demoPhotoExpiresAt(r.uploadedAt).getTime() <= now.getTime()) continue;
    out.set(r.batchId, toMerchantBatchPhoto(r));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Bytes (photo GET only)                                              */
/* ------------------------------------------------------------------ */

export type StoredBatchPhotoMeta = {
  batchId: string;
  photoId: string;
  contentType: string;
  byteSize: number;
  demoOnly: boolean;
  uploadedAt: Date;
  merchantId: string;
  merchantOwnerUserId: string;
  merchantIsPilot: boolean;
  batchStatus: BatchStatus;
  pickupEndTime: Date;
};

/**
 * The photo's metadata with everything canViewBatchPhoto needs, or null when the batch has
 * none. No bytes: a refused read must not pull up to 400 KB from the database first.
 */
export async function readBatchPhotoMeta(db: DbOrTx, batchId: string): Promise<StoredBatchPhotoMeta | null> {
  const [row] = await db
    .select({
      batchId: batchPhotos.surplusBatchId,
      photoId: batchPhotos.id,
      contentType: batchPhotos.contentType,
      byteSize: batchPhotos.byteSize,
      demoOnly: batchPhotos.demoOnly,
      uploadedAt: batchPhotos.uploadedAt,
      merchantId: batchPhotos.merchantId,
      merchantOwnerUserId: merchants.ownerUserId,
      merchantIsPilot: merchants.isPilot,
      batchStatus: surplusBatches.status,
      pickupEndTime: surplusBatches.pickupEndTime,
    })
    .from(batchPhotos)
    .innerJoin(surplusBatches, eq(surplusBatches.id, batchPhotos.surplusBatchId))
    .innerJoin(merchants, eq(merchants.id, batchPhotos.merchantId))
    .where(eq(batchPhotos.surplusBatchId, batchId))
    .limit(1);
  return row ?? null;
}

/**
 * The bytes of exactly that photo version, read only after the viewer was allowed. Null when
 * the photo was replaced or deleted since the metadata read.
 */
export async function readBatchPhotoBytes(db: DbOrTx, batchId: string, photoId: string): Promise<Buffer | null> {
  const [row] = await db
    .select({ bytes: batchPhotos.bytes })
    .from(batchPhotos)
    .where(and(eq(batchPhotos.surplusBatchId, batchId), eq(batchPhotos.id, photoId)))
    .limit(1);
  return row?.bytes ?? null;
}

/* ------------------------------------------------------------------ */
/* Upload / delete                                                     */
/* ------------------------------------------------------------------ */

/**
 * Throws 429 RATE_LIMITED when this upload would exceed a limit:
 *  - BATCH_PHOTO_MAX_UPLOADS per batch (surplus_batches.photo_upload_count, so deleting the
 *    photo does not reset it);
 *  - BATCH_PHOTO_MAX_UPLOADS_PER_HOUR per warung (rolling hour);
 *  - for demo uploads, DEMO_BATCH_PHOTO_MAX_LIVE live demo photos across all demo uploads
 *    (this batch's own photo is not counted, since it would be replaced).
 * Call it inside the upload transaction, after locking the owned batch.
 *
 * The batch row lock alone does not stop parallel uploads to different batches from all
 * counting before any of them commits, so the counts run under transaction-scoped advisory
 * locks: one per warung (hourly limit) and, for demo uploads, one shared key (live demo
 * cap). Advisory keys leave the merchants row free for checkout and profile writes; the
 * order (warung, then demo) is the same everywhere, so two uploads cannot deadlock.
 */
export async function checkPhotoUploadLimits(
  tx: DbOrTx,
  input: { batchId: string; merchantId: string; demoOnly: boolean; now: Date },
): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('batch_photo_upload'), hashtext(${input.merchantId}))`);
  if (input.demoOnly) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('batch_photo_demo'))`);

  const [batch] = await tx
    .select({ count: surplusBatches.photoUploadCount })
    .from(surplusBatches)
    .where(eq(surplusBatches.id, input.batchId))
    .limit(1);
  if ((batch?.count ?? 0) >= BATCH_PHOTO_MAX_UPLOADS) {
    throw new ApiError("RATE_LIMITED", `Paling banyak ${BATCH_PHOTO_MAX_UPLOADS} kali ganti foto per batch`);
  }

  const hourAgo = new Date(input.now.getTime() - 60 * MINUTE_MS);
  const [recent] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(batchPhotoUploads)
    .where(and(eq(batchPhotoUploads.merchantId, input.merchantId), gt(batchPhotoUploads.createdAt, hourAgo)));
  if ((recent?.n ?? 0) >= BATCH_PHOTO_MAX_UPLOADS_PER_HOUR) {
    throw new ApiError("RATE_LIMITED", `Paling banyak ${BATCH_PHOTO_MAX_UPLOADS_PER_HOUR} foto per jam. Coba lagi nanti.`);
  }

  if (input.demoOnly) {
    const demoSince = new Date(input.now.getTime() - DEMO_TTL_MS);
    const { rows } = await tx.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n
      FROM batch_photos bp
      JOIN surplus_batches b ON b.id = bp.surplus_batch_id
      WHERE bp.demo_only
        AND bp.uploaded_at > ${demoSince}
        AND b.status IN ('ACTIVE', 'SOLD_OUT', 'SCHEDULED')
        AND b.pickup_end_time > ${input.now}
        AND bp.surplus_batch_id <> ${input.batchId}`);
    if (Number(rows[0]?.n ?? 0) >= DEMO_BATCH_PHOTO_MAX_LIVE) {
      throw new ApiError("RATE_LIMITED", "Batas foto akun demo tercapai. Coba lagi nanti.");
    }
  }
}

/**
 * Stores (or replaces) the batch's photo with a fresh version id and upload time, counts the
 * upload on the batch and in the hourly log, and bumps the batch's updated_at so live
 * listeners refetch. Check the limits first (checkPhotoUploadLimits).
 */
export async function upsertBatchPhoto(
  tx: DbOrTx,
  input: {
    batchId: string;
    merchantId: string;
    bytes: Buffer;
    contentType: string;
    demoOnly: boolean;
    now: Date;
  },
): Promise<BatchPhotoResponse> {
  const values = {
    merchantId: input.merchantId,
    bytes: input.bytes,
    contentType: input.contentType,
    byteSize: input.bytes.byteLength,
    demoOnly: input.demoOnly,
    uploadedAt: input.now,
  };
  const [photo] = await tx
    .insert(batchPhotos)
    .values({ surplusBatchId: input.batchId, ...values })
    .onConflictDoUpdate({ target: batchPhotos.surplusBatchId, set: { ...values, id: sql`gen_random_uuid()` } })
    .returning({ photoId: batchPhotos.id, uploadedAt: batchPhotos.uploadedAt, demoOnly: batchPhotos.demoOnly });
  const [batch] = await tx
    .update(surplusBatches)
    .set({ photoUploadCount: sql`${surplusBatches.photoUploadCount} + 1`, updatedAt: input.now })
    .where(eq(surplusBatches.id, input.batchId))
    .returning({ count: surplusBatches.photoUploadCount });
  await tx.insert(batchPhotoUploads).values({ merchantId: input.merchantId, createdAt: input.now });
  const [merchant] = await tx
    .select({ isPilot: merchants.isPilot })
    .from(merchants)
    .where(eq(merchants.id, input.merchantId))
    .limit(1);

  return {
    photo: toMerchantBatchPhoto({
      batchId: input.batchId,
      photoId: photo.photoId,
      uploadedAt: photo.uploadedAt,
      demoOnly: photo.demoOnly,
      merchantIsPilot: merchant?.isPilot ?? false,
    }),
    photo_uploads_left: photoUploadsLeft(batch?.count ?? BATCH_PHOTO_MAX_UPLOADS),
  };
}

/**
 * Hard deletes the batch's photo. Bumps the batch's updated_at when there was one, so live
 * listeners drop it. Returns whether a photo was deleted.
 */
export async function deleteBatchPhoto(db: DbOrTx, batchId: string, now: Date = new Date()): Promise<boolean> {
  const deleted = await db
    .delete(batchPhotos)
    .where(eq(batchPhotos.surplusBatchId, batchId))
    .returning({ batchId: batchPhotos.surplusBatchId });
  if (deleted.length === 0) return false;
  await db.update(surplusBatches).set({ updatedAt: now }).where(eq(surplusBatches.id, batchId));
  return true;
}

/**
 * Minute job: hard deletes photos of batches that ended (past pickup_end_time, or EXPIRED or
 * CANCELLED) and demo photos past their TTL, and prunes the upload log. Returns the number
 * of photos deleted.
 */
export async function purgeEndedBatchPhotos(db: Db, now: Date = new Date()): Promise<number> {
  const demoSince = new Date(now.getTime() - DEMO_TTL_MS);
  const result = await db.execute(sql`
    DELETE FROM batch_photos bp
    USING surplus_batches b
    WHERE b.id = bp.surplus_batch_id
      AND (b.status NOT IN ('ACTIVE', 'SOLD_OUT', 'SCHEDULED')
           OR b.pickup_end_time <= ${now}
           OR (bp.demo_only AND bp.uploaded_at <= ${demoSince}))`);
  await db.execute(
    sql`DELETE FROM batch_photo_uploads WHERE created_at < ${new Date(now.getTime() - UPLOAD_LOG_RETENTION_MS)}`,
  );
  return result.rowCount ?? 0;
}
