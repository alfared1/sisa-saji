/**
 * POST/DELETE /api/v1/merchant/surplus/:batchId/photo ("Foto etalase malam ini"): JPEG only,
 * size and pixel caps, ownership, live batches only, upload limits that a delete does not
 * reset, and who may see the photo (PUBLIC for pilot warung, DEMO for demo accounts, OWNER
 * otherwise).
 */
import { and, eq, gt, inArray, ne, notInArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "@/db/client";
import { batchPhotos, batchPhotoUploads, menus, merchants, surplusBatches, type Merchant } from "@/db/schema";
import { DEMO_MERCHANT_SLUG } from "@/db/seed/data";
import {
  BATCH_PHOTO_MAX_BYTES,
  BATCH_PHOTO_MAX_UPLOADS,
  BATCH_PHOTO_MAX_UPLOADS_PER_HOUR,
  DEMO_BATCH_PHOTO_MAX_LIVE,
  DEMO_BATCH_PHOTO_TTL_MINUTES,
} from "@/lib/constants";
import { PublishBody, type BatchPhotoResponse } from "@/lib/contracts";
import { publishSurplus, uploadBatchPhoto } from "@/server/services/merchant/surplus";
import { reseed, testDb } from "../helpers/db";
import { mintSessionToken } from "../helpers/session";

// Route handlers call connection() and read the session cookie through next/headers.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => undefined,
}));
let sessionToken: string | null = null;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "ss_session" && sessionToken ? { name, value: sessionToken } : undefined),
    set: () => {},
    delete: () => {},
  }),
}));

const MIN = 60_000;
let db: Db;
let close: () => Promise<void>;
let owner: Merchant;
let demo: Merchant;

/** A minimal JPEG: SOI, a SOF0 frame of width × height, SOS, EOI. Padded with an APP1 segment. */
function jpeg(width = 640, height = 480, padTo = 0): Buffer {
  const frame = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const sos = [0xff, 0xda, 0x00, 0x0c, 0x03, 1, 0, 2, 0x11, 3, 0x11, 0x00, 0x3f, 0x00, 0x12, 0x34, 0xff, 0xd9];
  const segments: Buffer[] = [];
  let pad = padTo - 2 - frame.length - sos.length;
  while (pad > 4) {
    // APP1 segment: marker, 2-byte length (counting itself), then filler.
    const len = Math.min(pad - 2, 0xfff0);
    segments.push(Buffer.from([0xff, 0xe1, len >> 8, len & 0xff]), Buffer.alloc(len - 2, 0x41));
    pad -= len + 2;
  }
  return Buffer.concat([Buffer.from([0xff, 0xd8]), ...segments, Buffer.from(frame), Buffer.from(sos)]);
}
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const WEBP = Buffer.from("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ", "latin1");

async function as(userId: string) {
  sessionToken = await mintSessionToken(userId);
}

function photoReq(method: "POST" | "DELETE", batchId: string, body?: Buffer, headers: Record<string, string> = {}) {
  return new Request(`http://localhost/api/v1/merchant/surplus/${batchId}/photo`, {
    method,
    headers: { "content-type": "image/jpeg", ...headers },
    body: body ? Uint8Array.from(body) : undefined,
  });
}
const ctx = (batchId: string) => ({ params: Promise.resolve({ batchId }) });

async function upload(batchId: string, body: Buffer = jpeg(), headers?: Record<string, string>) {
  const { POST } = await import("@/app/api/v1/merchant/surplus/[batchId]/photo/route");
  return POST(photoReq("POST", batchId, body, headers), ctx(batchId));
}
async function remove(batchId: string) {
  const { DELETE } = await import("@/app/api/v1/merchant/surplus/[batchId]/photo/route");
  return DELETE(photoReq("DELETE", batchId), ctx(batchId));
}
async function data(res: Response) {
  return ((await res.json()) as { data: BatchPhotoResponse }).data;
}
async function errorOf(res: Response) {
  return ((await res.json()) as { error: { code: string; message: string } }).error;
}

/** A listed menu of the merchant, created for the test so the seed's menus do not matter. */
async function testMenu(merchantId: string) {
  const [m] = await db
    .insert(menus)
    .values({
      merchantId,
      menuName: "Nasi Rames (tes foto)",
      category: "MAKANAN_BERAT",
      originalPriceIdr: 20000,
      minRecoveryPriceIdr: 10000,
      contents: ["Nasi putih", "Sayur asem"],
    })
    .returning();
  return m;
}
async function publishFor(merchant: Merchant, now = new Date()) {
  const menu = await testMenu(merchant.id);
  const { batch } = await publishSurplus(
    db,
    merchant.id,
    PublishBody.parse({ menu_id: menu.id, initial_stock: 3, pickup_end_time: new Date(now.getTime() + 120 * MIN).toISOString() }),
    now,
  );
  return batch;
}
const photoRows = (batchId: string) => db.select().from(batchPhotos).where(eq(batchPhotos.surplusBatchId, batchId));

beforeAll(async () => {
  ({ db, close } = testDb());
  vi.spyOn(console, "log").mockImplementation(() => {});
  await reseed(db);
  [demo] = await db.select().from(merchants).where(eq(merchants.slug, DEMO_MERCHANT_SLUG));
  [owner] = await db
    .select()
    .from(merchants)
    .where(and(ne(merchants.slug, DEMO_MERCHANT_SLUG), eq(merchants.isPilot, false)))
    .limit(1);
});
afterAll(async () => {
  vi.restoreAllMocks();
  await reseed(db);
  await close();
});

describe("upload checks", () => {
  it("stores a JPEG of an owned live batch (201), visible to the owner only for a non-pilot warung", async () => {
    const batch = await publishFor(owner);
    await as(owner.ownerUserId);
    const res = await upload(batch.id);
    expect(res.status).toBe(201);
    const body = await data(res);
    expect(body.photo).toMatchObject({ visibility: "OWNER", demo_only: false, expires_at: null });
    expect(body.photo?.url).toMatch(new RegExp(`^/api/v1/batches/${batch.id}/photo\\?v=[0-9a-f-]{36}$`));
    expect(body.photo_uploads_left).toBe(BATCH_PHOTO_MAX_UPLOADS - 1);
    const [row] = await photoRows(batch.id);
    expect(row).toMatchObject({ contentType: "image/jpeg", demoOnly: false, merchantId: owner.id });
    expect(Buffer.from(row.bytes).equals(jpeg())).toBe(true);
  });

  it("refuses PNG, SVG, WebP and garbage with 415, and a huge frame with 400", async () => {
    const batch = await publishFor(owner);
    await as(owner.ownerUserId);
    for (const bytes of [PNG, SVG, WEBP, Buffer.from("not an image at all")]) {
      const res = await upload(batch.id, bytes);
      expect(res.status).toBe(415);
      expect((await errorOf(res)).code).toBe("VALIDATION_ERROR");
    }
    expect((await upload(batch.id, jpeg(30000, 30000))).status).toBe(400);
    expect((await upload(batch.id, Buffer.alloc(0))).status).toBe(400);
    expect(await photoRows(batch.id)).toHaveLength(0);
    // Refused uploads do not use up the batch's uploads.
    const [b] = await db.select().from(surplusBatches).where(eq(surplusBatches.id, batch.id));
    expect(b.photoUploadCount).toBe(0);
  });

  it("refuses more than 400 KB with 413, by declared length and while reading", async () => {
    const batch = await publishFor(owner);
    await as(owner.ownerUserId);
    const big = jpeg(640, 480, BATCH_PHOTO_MAX_BYTES + 1024);
    expect(big.byteLength).toBeGreaterThan(BATCH_PHOTO_MAX_BYTES);
    expect((await upload(batch.id, big)).status).toBe(413);
    expect((await upload(batch.id, jpeg(), { "content-length": String(BATCH_PHOTO_MAX_BYTES + 1) })).status).toBe(413);
    const fits = jpeg(640, 480, BATCH_PHOTO_MAX_BYTES - 64);
    expect((await upload(batch.id, fits)).status).toBe(201);
  });

  it("404s for another warung's batch or a bad id, 409 once the batch ended, 401 when logged out", async () => {
    const foreign = await publishFor(demo);
    await as(owner.ownerUserId);
    const res = await upload(foreign.id);
    expect(res.status).toBe(404);
    expect(await photoRows(foreign.id)).toHaveLength(0);
    expect((await upload("not-a-uuid")).status).toBe(404);

    // Published three hours ago with a two-hour window: ended an hour ago (still ACTIVE until the job runs).
    const ended = await publishFor(owner, new Date(Date.now() - 180 * MIN));
    const closed = await upload(ended.id);
    expect(closed.status).toBe(409);
    expect(await errorOf(closed)).toMatchObject({ code: "BATCH_CLOSED", message: "Batch sudah berakhir" });

    sessionToken = null;
    expect((await upload(ended.id)).status).toBe(401);
  });
});

describe("upload limits", () => {
  it(`allows ${BATCH_PHOTO_MAX_UPLOADS} uploads per batch; deleting does not reset the count`, async () => {
    const batch = await publishFor(owner);
    await as(owner.ownerUserId);
    for (let i = 0; i < BATCH_PHOTO_MAX_UPLOADS - 1; i++) expect((await upload(batch.id)).status).toBe(201);

    const del = await remove(batch.id);
    expect(del.status).toBe(200);
    expect(await data(del)).toEqual({ photo: null, photo_uploads_left: 1 });
    expect(await photoRows(batch.id)).toHaveLength(0);

    expect((await upload(batch.id)).status).toBe(201);
    const sixth = await upload(batch.id);
    expect(sixth.status).toBe(429);
    expect(await errorOf(sixth)).toMatchObject({ code: "RATE_LIMITED", message: "Paling banyak 5 kali ganti foto per batch" });
  });

  it("a replaced photo gets a new version id (the ?v= cache buster)", async () => {
    const batch = await publishFor(owner);
    await as(owner.ownerUserId);
    const first = await data(await upload(batch.id));
    const second = await data(await upload(batch.id));
    expect(second.photo?.url).not.toBe(first.photo?.url);
    expect(await photoRows(batch.id)).toHaveLength(1);
  });

  it(`allows ${BATCH_PHOTO_MAX_UPLOADS_PER_HOUR} uploads per warung per hour`, async () => {
    const batch = await publishFor(owner);
    await as(owner.ownerUserId);
    const hourAgo = new Date(Date.now() - 50 * MIN);
    const recent = await db
      .select({ id: batchPhotoUploads.id })
      .from(batchPhotoUploads)
      .where(and(eq(batchPhotoUploads.merchantId, owner.id), gt(batchPhotoUploads.createdAt, new Date(Date.now() - 60 * MIN))));
    const missing = BATCH_PHOTO_MAX_UPLOADS_PER_HOUR - recent.length;
    if (missing > 0) {
      await db.insert(batchPhotoUploads).values(Array.from({ length: missing }, () => ({ merchantId: owner.id, createdAt: hourAgo })));
    }
    const res = await upload(batch.id);
    expect(res.status).toBe(429);
    expect((await errorOf(res)).message).toMatch(/foto per jam/);
    await db.delete(batchPhotoUploads).where(eq(batchPhotoUploads.merchantId, owner.id));
  });

  it(`refuses demo uploads past ${DEMO_BATCH_PHOTO_MAX_LIVE} live demo photos`, async () => {
    const target = await publishFor(demo);
    const live = await db
      .select({ id: surplusBatches.id, merchantId: surplusBatches.merchantId })
      .from(surplusBatches)
      .where(
        and(
          inArray(surplusBatches.status, ["ACTIVE", "SOLD_OUT"]),
          gt(surplusBatches.pickupEndTime, new Date(Date.now() + 10 * MIN)),
          ne(surplusBatches.id, target.id),
        ),
      )
      .limit(DEMO_BATCH_PHOTO_MAX_LIVE);
    expect(live).toHaveLength(DEMO_BATCH_PHOTO_MAX_LIVE);
    await db.insert(batchPhotos).values(
      live.map((b) => ({
        surplusBatchId: b.id,
        merchantId: b.merchantId,
        bytes: jpeg(),
        contentType: "image/jpeg",
        byteSize: jpeg().byteLength,
        demoOnly: true,
      })),
    );
    await as(demo.ownerUserId);
    const res = await upload(target.id);
    expect(res.status).toBe(429);
    expect((await errorOf(res)).message).toBe("Batas foto akun demo tercapai. Coba lagi nanti.");
    await db.delete(batchPhotos).where(
      inArray(
        batchPhotos.surplusBatchId,
        live.map((b) => b.id),
      ),
    );
    expect((await upload(target.id)).status).toBe(201);
  });

  it("parallel demo uploads to different batches still stop at the live demo cap", async () => {
    await db.delete(batchPhotos).where(eq(batchPhotos.demoOnly, true));
    const targets = [];
    for (let i = 0; i < 5; i++) targets.push(await publishFor(demo));
    const others = await db
      .select({ id: surplusBatches.id, merchantId: surplusBatches.merchantId })
      .from(surplusBatches)
      .where(
        and(
          inArray(surplusBatches.status, ["ACTIVE", "SOLD_OUT"]),
          gt(surplusBatches.pickupEndTime, new Date(Date.now() + 10 * MIN)),
          ne(surplusBatches.merchantId, demo.id),
          notInArray(surplusBatches.id, db.select({ id: batchPhotos.surplusBatchId }).from(batchPhotos)),
        ),
      )
      .limit(DEMO_BATCH_PHOTO_MAX_LIVE - 2);
    expect(others).toHaveLength(DEMO_BATCH_PHOTO_MAX_LIVE - 2);
    await db.insert(batchPhotos).values(
      others.map((b) => ({
        surplusBatchId: b.id,
        merchantId: b.merchantId,
        bytes: jpeg(),
        contentType: "image/jpeg",
        byteSize: jpeg().byteLength,
        demoOnly: true,
      })),
    );
    const { db: racingDb, pool } = createDb(process.env.DATABASE_URL!, { max: targets.length });
    try {
      const results = await Promise.allSettled(
        targets.map((b) =>
          uploadBatchPhoto(racingDb, demo.id, b.id, { bytes: jpeg(), contentType: "image/jpeg", demoOnly: true }),
        ),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
      for (const r of results) {
        if (r.status === "rejected") expect(r.reason).toMatchObject({ code: "RATE_LIMITED" });
      }
    } finally {
      await pool.end();
      await db.delete(batchPhotos).where(eq(batchPhotos.demoOnly, true));
    }
  });
});

describe("visibility recorded for the owner", () => {
  it("a demo-account photo is demo_only and expires after the TTL", async () => {
    const batch = await publishFor(demo);
    await as(demo.ownerUserId);
    const before = Date.now();
    const body = await data(await upload(batch.id));
    expect(body.photo).toMatchObject({ visibility: "DEMO", demo_only: true });
    const expires = Date.parse(body.photo!.expires_at!);
    expect(expires).toBeGreaterThanOrEqual(before + DEMO_BATCH_PHOTO_TTL_MINUTES * MIN - 1000);
    expect(expires).toBeLessThanOrEqual(Date.now() + DEMO_BATCH_PHOTO_TTL_MINUTES * MIN + 1000);
    const [row] = await photoRows(batch.id);
    expect(row.demoOnly).toBe(true);
  });

  it("a pilot warung's photo is public", async () => {
    const batch = await publishFor(owner);
    await db.update(merchants).set({ isPilot: true }).where(eq(merchants.id, owner.id));
    try {
      await as(owner.ownerUserId);
      const body = await data(await upload(batch.id));
      expect(body.photo).toMatchObject({ visibility: "PUBLIC", demo_only: false, expires_at: null });
    } finally {
      await db.update(merchants).set({ isPilot: false }).where(eq(merchants.id, owner.id));
    }
  });

  it("DELETE only touches the caller's own batch", async () => {
    const batch = await publishFor(owner);
    await as(owner.ownerUserId);
    expect((await upload(batch.id)).status).toBe(201);
    await as(demo.ownerUserId);
    expect((await remove(batch.id)).status).toBe(404);
    expect(await photoRows(batch.id)).toHaveLength(1);
  });
});
