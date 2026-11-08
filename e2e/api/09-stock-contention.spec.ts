import { expect, request as pwRequest, test, type APIRequestContext } from "@playwright/test";
import type { MenuView, PublishResponse } from "../../src/lib/contracts";
import { DEMO_MERCHANT_EMAIL, E2E_BASE_URL } from "../env";
import { checkout, db, errorCode, ok, registerCustomer, sessionTokenFor } from "../helpers";

test("5 parallel checkouts for a 2-portion batch → exactly 2 succeed, no overselling", async () => {
  const merchant = await pwRequest.newContext({
    baseURL: E2E_BASE_URL,
    extraHTTPHeaders: { cookie: `ss_session=${await sessionTokenFor(DEMO_MERCHANT_EMAIL)}` },
  });
  // Own menu + batch so the test never collides with other specs' batches.
  const { menu } = await ok<{ menu: MenuView }>(
    await merchant.post("/api/v1/merchant/menus", {
      data: {
        menu_name: `Nasi Rebutan ${Date.now()}`,
        category: "MAKANAN_BERAT",
        original_price_idr: 16000,
        min_recovery_price_idr: 6000,
      },
    }),
  );
  const { batch } = await ok<PublishResponse>(
    await merchant.post("/api/v1/merchant/surplus/publish", {
      data: { menu_id: menu.id, initial_stock: 2, pickup_end_time: new Date(Date.now() + 120 * 60_000).toISOString() },
    }),
  );
  expect(batch.available_stock).toBe(2);

  const customers: APIRequestContext[] = [];
  for (let i = 0; i < 5; i++) {
    const ctx = await pwRequest.newContext({ baseURL: E2E_BASE_URL });
    await registerCustomer(ctx, `Rebutan ${i + 1}`);
    customers.push(ctx);
  }

  const { rows: m } = await db().query<{ merchant_id: string }>("select merchant_id from menus where id = $1", [menu.id]);
  const results = await Promise.all(
    customers.map((c) => checkout(c, { merchant_id: m[0].merchant_id, items: [{ batch_id: batch.id, quantity: 1 }] })),
  );
  const statuses = results.map((r) => r.status());
  expect(statuses.filter((s) => s === 201)).toHaveLength(2);
  const failures = results.filter((r) => r.status() !== 201);
  expect(failures).toHaveLength(3);
  for (const f of failures) expect(await errorCode(f)).toBe("OUT_OF_STOCK");

  const { rows } = await db().query<{ initial_stock: number; available_stock: number; reserved_stock: number }>(
    "select initial_stock, available_stock, reserved_stock from surplus_batches where id = $1",
    [batch.id],
  );
  expect(rows[0]).toMatchObject({ initial_stock: 2, available_stock: 0, reserved_stock: 2 });

  await Promise.all([...customers, merchant].map((c) => c.dispose()));
});
