/**
 * "Titip Antar Kolektif" waiting list through the route handlers: the count is public, a
 * login is needed to register (demo accounts refused with DEMO_LOCKED), one row per user,
 * DELETE withdraws, and kos names never reach anyone but their author.
 */
import { randomInt } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { deliveryInterests, orders, users } from "@/db/schema";
import type { DeliveryInterestResponse } from "@/lib/contracts";
import { DEMO_ACCOUNTS, DEMO_LOCKED_REASON } from "@/lib/demo-accounts";
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

let db: Db;
let close: () => Promise<void>;
let demoBuyerId: string;

beforeAll(async () => {
  ({ db, close } = testDb());
  await reseed(db);
  [{ id: demoBuyerId }] = await db.select({ id: users.id }).from(users).where(eq(users.email, DEMO_ACCOUNTS.CUSTOMER.email));
});
afterAll(async () => {
  await db.delete(deliveryInterests);
  await close();
});

async function newCustomer() {
  const [u] = await db
    .insert(users)
    .values({ fullName: "Pembeli Kos", phoneNumber: `+62893${String(randomInt(0, 10 ** 8)).padStart(8, "0")}` })
    .returning();
  return u;
}

async function as(userId: string | null) {
  sessionToken = userId ? await mintSessionToken(userId) : null;
}

function req(method: string, body?: unknown) {
  return new Request("http://localhost/api/v1/delivery-interest", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function call(method: "GET" | "POST" | "DELETE", body?: unknown) {
  const route = await import("@/app/api/v1/delivery-interest/route");
  const res = await route[method](req(method, body), undefined);
  const text = await res.text();
  const json = JSON.parse(text) as { success: boolean; data?: DeliveryInterestResponse; error?: { code: string; details?: unknown } };
  return { status: res.status, text, json };
}

describe("delivery interest", () => {
  it("GET is public: anonymous viewers see the count only", async () => {
    await as(null);
    const res = await call("GET");
    expect(res.status).toBe(200);
    expect(res.json.data).toEqual({ count: 0, mine: null });
  });

  it("POST needs a login", async () => {
    await as(null);
    const res = await call("POST", { kos_name: "Asrama Putra IPB" });
    expect(res.status).toBe(401);
    expect(res.json.error?.code).toBe("UNAUTHENTICATED");
  });

  it("refuses the shared demo account with DEMO_LOCKED and does not count it", async () => {
    await as(demoBuyerId);
    const res = await call("POST", { kos_name: "Kos Demo" });
    expect(res.status).toBe(403);
    expect(res.json.error).toMatchObject({ code: "FORBIDDEN", details: { reason: DEMO_LOCKED_REASON } });
    // Even a row written around the route is left out of the public count.
    await db.insert(deliveryInterests).values({ userId: demoBuyerId, kosName: "Kos Demo" });
    await as(null);
    expect((await call("GET")).json.data?.count).toBe(0);
    await db.delete(deliveryInterests).where(eq(deliveryInterests.userId, demoBuyerId));
  });

  it("upserts one row per user; the author sees their kos name, nobody else does", async () => {
    const a = await newCustomer();
    const b = await newCustomer();
    await as(a.id);
    expect((await call("POST", { kos_name: "  Asrama Putra IPB " })).json.data).toEqual({
      count: 1,
      mine: { kos_name: "Asrama Putra IPB" },
    });
    expect((await call("POST", { kos_name: "Kos Melati Babakan" })).json.data).toEqual({
      count: 1,
      mine: { kos_name: "Kos Melati Babakan" },
    });
    expect(await db.select().from(deliveryInterests).where(eq(deliveryInterests.userId, a.id))).toHaveLength(1);

    await as(b.id);
    const other = await call("GET");
    expect(other.json.data).toEqual({ count: 1, mine: null });
    expect(other.text).not.toContain("Melati");
    await call("POST", { kos_name: "Asrama Putri" });

    await as(null);
    const anon = await call("GET");
    expect(anon.json.data).toEqual({ count: 2, mine: null });
    expect(anon.text).not.toContain("Melati");
    expect(anon.text).not.toContain("Asrama");
  });

  it("validates the kos name", async () => {
    await as((await newCustomer()).id);
    for (const kos_name of ["", "A", "x".repeat(61)]) {
      const res = await call("POST", { kos_name });
      expect(res.status).toBe(400);
      expect(res.json.error?.code).toBe("VALIDATION_ERROR");
    }
  });

  it("DELETE withdraws the viewer's interest and needs a login", async () => {
    await as(null);
    expect((await call("DELETE")).status).toBe(401);
    const c = await newCustomer();
    await as(c.id);
    const before = (await call("POST", { kos_name: "Kos Hijau" })).json.data?.count ?? 0;
    const after = await call("DELETE");
    expect(after.json.data).toEqual({ count: before - 1, mine: null });
    // Deleting again is a no-op.
    expect((await call("DELETE")).json.data).toEqual({ count: before - 1, mine: null });
  });

  it("never touches orders", async () => {
    const c = await newCustomer();
    await as(c.id);
    await call("POST", { kos_name: "Kos Mawar" });
    expect(await db.select().from(orders).where(eq(orders.customerId, c.id))).toHaveLength(0);
  });
});
