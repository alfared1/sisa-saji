/**
 * Batch photos on the buyer side: which photo each viewer gets in discovery and from
 * GET /batches/:batchId/photo (amendment A visibility), and the menu image rule.
 *  - pilot warung: public ("real"), Cache-Control public;
 *  - demo-account upload: only demo sessions and the owner, for 60 minutes ("demo");
 *  - any other warung: only its owner, never listed to buyers;
 *  - always only while the batch is live; one 404 message for every refusal.
 * Photos are stored with the foundation service (the upload route is tested elsewhere).
 */
import { randomInt } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { batchPhotos, menus, merchants, surplusBatches, users } from "@/db/schema";
import { DEMO_MERCHANT_SLUG } from "@/db/seed/data";
import { CAMPUSES } from "@/lib/constants";
import { DiscoverQuery, type BatchCard, type MerchantSummary } from "@/lib/contracts";
import { DEMO_ACCOUNTS } from "@/lib/demo-accounts";
import { upsertBatchPhoto } from "@/server/services/batch-photos";
import { findNearby, getMerchantDetail } from "@/server/services/discovery/discovery";
import { reseed, testDb } from "../helpers/db";
import { mintSessionToken } from "../helpers/session";

// The route handler calls connection() and reads the session cookie through next/headers.
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

const IPB = CAMPUSES[0];
/** A tiny stand-in JPEG (SOI + APP0 marker bytes); the GET serves stored bytes as they are. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

let db: Db;
let close: () => Promise<void>;
let demoBuyerId: string;
let strangerId: string;
let pilot: { merchantId: string; ownerId: string; batchId: string; menuId: string };
let owned: { merchantId: string; ownerId: string; batchId: string; menuId: string };
let demo: { merchantId: string; ownerId: string; batchId: string };

const nearby = (viewerIsDemo = false) =>
  findNearby(db, DiscoverQuery.parse({ lat: IPB.lat, lng: IPB.lng, radius_m: 5000 }), new Date(), { viewerIsDemo });

function cardOf(list: MerchantSummary[], batchId: string): BatchCard | undefined {
  return list.flatMap((m) => m.batches).find((b) => b.batch_id === batchId);
}

async function as(userId: string | null) {
  sessionToken = userId ? await mintSessionToken(userId) : null;
}

async function getPhoto(batchId: string, query = "") {
  const { GET } = await import("@/app/api/v1/batches/[batchId]/photo/route");
  return GET(new Request(`http://localhost/api/v1/batches/${batchId}/photo${query}`), {
    params: Promise.resolve({ batchId }),
  });
}

async function expectNotAvailable(res: Response) {
  expect(res.status).toBe(404);
  const json = (await res.json()) as { error: { code: string; message: string } };
  expect(json.error).toMatchObject({ code: "NOT_FOUND", message: "Foto tidak tersedia" });
}

async function store(batchId: string, merchantId: string, demoOnly: boolean, now = new Date()) {
  return upsertBatchPhoto(db, { batchId, merchantId, bytes: JPEG, contentType: "image/jpeg", demoOnly, now });
}

beforeAll(async () => {
  ({ db, close } = testDb());
  await reseed(db);

  const list = (await nearby()).merchants.filter((m) => m.slug !== DEMO_MERCHANT_SLUG && m.batches.length > 0);
  expect(list.length).toBeGreaterThanOrEqual(2);
  const pick = async (m: MerchantSummary) => {
    const [row] = await db.select({ ownerId: merchants.ownerUserId }).from(merchants).where(eq(merchants.id, m.id));
    return { merchantId: m.id, ownerId: row.ownerId, batchId: m.batches[0].batch_id, menuId: m.batches[0].menu_id };
  };
  pilot = await pick(list[0]);
  owned = await pick(list[1]);
  await db.update(merchants).set({ isPilot: true }).where(eq(merchants.id, pilot.merchantId));

  const [dm] = await db.select().from(merchants).where(eq(merchants.slug, DEMO_MERCHANT_SLUG));
  const [db1] = await db
    .select({ id: surplusBatches.id })
    .from(surplusBatches)
    .where(sql`${surplusBatches.merchantId} = ${dm.id} AND ${surplusBatches.status} = 'ACTIVE' AND ${surplusBatches.availableStock} > 0 AND ${surplusBatches.pickupEndTime} > now()`)
    .limit(1);
  demo = { merchantId: dm.id, ownerId: dm.ownerUserId, batchId: db1.id };

  [{ id: demoBuyerId }] = await db.select({ id: users.id }).from(users).where(eq(users.email, DEMO_ACCOUNTS.CUSTOMER.email));
  [{ id: strangerId }] = await db
    .insert(users)
    .values({ fullName: "Penguji Foto", phoneNumber: `+62897${String(randomInt(0, 10 ** 8)).padStart(8, "0")}` })
    .returning({ id: users.id });

  await store(pilot.batchId, pilot.merchantId, false);
  await store(owned.batchId, owned.merchantId, false);
  await store(demo.batchId, demo.merchantId, true);
});

afterAll(async () => {
  sessionToken = null;
  await reseed(db);
  await close();
});

describe("discovery lists only the photos the viewer may see", () => {
  it("anonymous: the pilot photo as 'real', no owner-only or demo photo", async () => {
    const r = await nearby(false);
    const p = cardOf(r.merchants, pilot.batchId)!;
    const [row] = await db.select({ id: batchPhotos.id }).from(batchPhotos).where(eq(batchPhotos.surplusBatchId, pilot.batchId));
    expect(p.photo).toMatchObject({ kind: "real", url: `/api/v1/batches/${pilot.batchId}/photo?v=${row.id}` });
    expect(Date.parse(p.photo!.uploaded_at)).not.toBeNaN();
    expect(cardOf(r.merchants, owned.batchId)!.photo).toBeNull();
    expect(cardOf(r.merchants, demo.batchId)?.photo ?? null).toBeNull();
  });

  it("demo session: also the fresh demo photo, as 'demo'; still no owner-only photo", async () => {
    const r = await nearby(true);
    expect(cardOf(r.merchants, demo.batchId)!.photo).toMatchObject({ kind: "demo" });
    expect(cardOf(r.merchants, pilot.batchId)!.photo).toMatchObject({ kind: "real" });
    expect(cardOf(r.merchants, owned.batchId)!.photo).toBeNull();
  });

  it("merchant detail follows the same rule", async () => {
    const anon = await getMerchantDetail(db, DEMO_MERCHANT_SLUG, { userId: null });
    expect(anon.batches.find((b) => b.batch_id === demo.batchId)?.photo ?? null).toBeNull();
    const asDemo = await getMerchantDetail(db, DEMO_MERCHANT_SLUG, { userId: demoBuyerId, viewerIsDemo: true });
    expect(asDemo.batches.find((b) => b.batch_id === demo.batchId)!.photo).toMatchObject({ kind: "demo" });
  });

  it("never carries the image bytes", async () => {
    const body = JSON.stringify(await nearby(true));
    expect(body).not.toContain('"bytes"');
    expect(body).not.toContain(JPEG.toString("base64"));
  });

  it("sends the menu image only for pilot warung", async () => {
    const url = "https://example.com/menu.jpg";
    await db.update(menus).set({ imageUrl: url }).where(sql`${menus.id} IN (${pilot.menuId}, ${owned.menuId})`);
    try {
      const r = await nearby(false);
      expect(cardOf(r.merchants, pilot.batchId)!.image_url).toBe(url);
      expect(cardOf(r.merchants, owned.batchId)!.image_url).toBeNull();
    } finally {
      await db.update(menus).set({ imageUrl: null }).where(sql`${menus.id} IN (${pilot.menuId}, ${owned.menuId})`);
    }
  });
});

describe("GET /batches/:batchId/photo", () => {
  it("serves a pilot photo to anyone, with safe headers and public caching", async () => {
    await as(null);
    const res = await getPhoto(pilot.batchId, "?v=1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("content-length")).toBe(String(JPEG.byteLength));
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(Buffer.from(await res.arrayBuffer()).equals(JPEG)).toBe(true);
  });

  it("an owner-only photo reaches only its owner, never cached", async () => {
    for (const viewer of [null, strangerId, demoBuyerId, pilot.ownerId]) {
      await as(viewer);
      await expectNotAvailable(await getPhoto(owned.batchId));
    }
    await as(owned.ownerId);
    const res = await getPhoto(owned.batchId);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("a demo photo reaches demo sessions and its owner, not anyone else", async () => {
    for (const viewer of [null, strangerId]) {
      await as(viewer);
      await expectNotAvailable(await getPhoto(demo.batchId));
    }
    for (const viewer of [demoBuyerId, demo.ownerId]) {
      await as(viewer);
      const res = await getPhoto(demo.batchId);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    }
  });

  it("a demo photo expires 60 minutes after upload, in the GET and in discovery", async () => {
    const old = new Date(Date.now() - 61 * 60_000);
    await db.update(batchPhotos).set({ uploadedAt: old }).where(eq(batchPhotos.surplusBatchId, demo.batchId));
    try {
      await as(demoBuyerId);
      await expectNotAvailable(await getPhoto(demo.batchId));
      expect(cardOf((await nearby(true)).merchants, demo.batchId)?.photo ?? null).toBeNull();
    } finally {
      await db.update(batchPhotos).set({ uploadedAt: new Date() }).where(eq(batchPhotos.surplusBatchId, demo.batchId));
    }
  });

  it("refuses once the batch is cancelled or past its pickup end, even for the owner", async () => {
    const [before] = await db.select().from(surplusBatches).where(eq(surplusBatches.id, pilot.batchId));
    try {
      await db.update(surplusBatches).set({ status: "CANCELLED" }).where(eq(surplusBatches.id, pilot.batchId));
      for (const viewer of [null, pilot.ownerId]) {
        await as(viewer);
        await expectNotAvailable(await getPhoto(pilot.batchId));
      }
      await db
        .update(surplusBatches)
        .set({ status: "ACTIVE", pickupEndTime: new Date(Date.now() - 60_000) })
        .where(eq(surplusBatches.id, pilot.batchId));
      await as(null);
      await expectNotAvailable(await getPhoto(pilot.batchId));
    } finally {
      await db
        .update(surplusBatches)
        .set({ status: before.status, pickupEndTime: before.pickupEndTime })
        .where(eq(surplusBatches.id, pilot.batchId));
    }
  });

  it("answers the same 404 for unknown batches and malformed ids", async () => {
    await as(null);
    await expectNotAvailable(await getPhoto("00000000-0000-4000-8000-000000000000"));
    await expectNotAvailable(await getPhoto("bukan-uuid"));
  });
});
