/**
 * Menu photos: the owner uploads a JPEG for a menu (image_url points at the stored photo),
 * buyers can load it only for field pilot warung, other warung see a 404, the demo warung is
 * locked, and deleting clears image_url.
 */
import { and, asc, eq, ne } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { menuPhotos, menus, merchants } from "@/db/schema";
import { DEMO_MERCHANT_SLUG } from "@/db/seed/data";
import { reseed, testDb } from "../helpers/db";
import { mintSessionToken } from "../helpers/session";

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

/** A minimal JPEG: SOI, a 640 × 480 SOF0 frame, SOS, EOI. */
function tinyJpeg(): Uint8Array {
  const frame = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const sos = [0xff, 0xda, 0x00, 0x0c, 0x03, 1, 0, 2, 0x11, 3, 0x11, 0x00, 0x3f, 0x00, 0x12, 0x34, 0xff, 0xd9];
  return new Uint8Array([0xff, 0xd8, ...frame, ...sos]);
}

let db: Db;
let close: () => Promise<void>;
let owner: typeof merchants.$inferSelect;
let menu: typeof menus.$inferSelect;

beforeAll(async () => {
  ({ db, close } = testDb());
  vi.spyOn(console, "log").mockImplementation(() => {});
  await reseed(db);
  [owner] = await db
    .select()
    .from(merchants)
    .where(and(ne(merchants.slug, DEMO_MERCHANT_SLUG), eq(merchants.isPilot, false)))
    .limit(1);
  [menu] = await db.select().from(menus).where(eq(menus.merchantId, owner.id)).orderBy(asc(menus.id)).limit(1);
});
afterAll(async () => {
  vi.restoreAllMocks();
  await close();
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const upload = (id: string, body: Uint8Array = tinyJpeg()) =>
  new Request(`http://localhost/api/v1/merchant/menus/${id}/photo`, {
    method: "POST",
    headers: { "content-type": "image/jpeg" },
    body: body as BodyInit,
  });
const get = (id: string) => new Request(`http://localhost/api/v1/menus/${id}/photo`);

describe("menu photos", () => {
  it("owner uploads, sees the preview; buyers only once the warung is in the pilot; delete clears it", async () => {
    const write = await import("@/app/api/v1/merchant/menus/[id]/photo/route");
    const read = await import("@/app/api/v1/menus/[id]/photo/route");

    sessionToken = await mintSessionToken(owner.ownerUserId);
    const res = await write.POST(upload(menu.id), ctx(menu.id));
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: { menu: { image_url: string } } };
    expect(data.menu.image_url).toMatch(new RegExp(`^/api/v1/menus/${menu.id}/photo\\?v=[0-9a-f-]{36}$`));

    // The owner sees the preview (private).
    const mine = await read.GET(get(menu.id), ctx(menu.id));
    expect(mine.status).toBe(200);
    expect(mine.headers.get("content-type")).toBe("image/jpeg");
    expect(mine.headers.get("cache-control")).toBe("private, no-store");

    // Anyone else: not available until the warung is a pilot warung.
    sessionToken = null;
    expect((await read.GET(get(menu.id), ctx(menu.id))).status).toBe(404);
    await db.update(merchants).set({ isPilot: true }).where(eq(merchants.id, owner.id));
    const pub = await read.GET(get(menu.id), ctx(menu.id));
    expect(pub.status).toBe(200);
    expect(pub.headers.get("cache-control")).toMatch(/^public/);
    await db.update(merchants).set({ isPilot: false }).where(eq(merchants.id, owner.id));

    // Not a JPEG → 415; foreign menu → 404.
    sessionToken = await mintSessionToken(owner.ownerUserId);
    expect((await write.POST(upload(menu.id, new Uint8Array([0x89, 0x50, 0x4e, 0x47])), ctx(menu.id))).status).toBe(415);
    const [foreign] = await db.select().from(menus).where(ne(menus.merchantId, owner.id)).limit(1);
    expect((await write.POST(upload(foreign.id), ctx(foreign.id))).status).toBe(404);

    const del = await write.DELETE(new Request("http://localhost"), ctx(menu.id));
    expect(del.status).toBe(200);
    expect(((await del.json()) as { data: { menu: { image_url: string | null } } }).data.menu.image_url).toBeNull();
    expect(await db.select().from(menuPhotos).where(eq(menuPhotos.menuId, menu.id))).toHaveLength(0);
    sessionToken = null;
  });

  it("the shared demo warung cannot change menu photos", async () => {
    const write = await import("@/app/api/v1/merchant/menus/[id]/photo/route");
    const [demo] = await db.select().from(merchants).where(eq(merchants.slug, DEMO_MERCHANT_SLUG));
    const [demoMenu] = await db.select().from(menus).where(eq(menus.merchantId, demo.id)).limit(1);
    sessionToken = await mintSessionToken(demo.ownerUserId);
    const res = await write.POST(upload(demoMenu.id), ctx(demoMenu.id));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { details: { reason: string } } }).error.details.reason).toBe("DEMO_LOCKED");
    sessionToken = null;
  });
});
