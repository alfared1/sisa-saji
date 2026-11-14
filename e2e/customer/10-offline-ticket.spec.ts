import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "../fixtures";
import type { BatchCard, OrderDetail } from "../../src/lib/contracts";
import { checkout, nearby, ok, registerCustomer } from "../helpers";

/** A live batch with a lauk to choose, so the ticket shows "Lauk: …". */
async function batchWithLauk(request: APIRequestContext): Promise<BatchCard> {
  const { merchants } = await nearby(request);
  const batch = merchants.flatMap((m) => m.batches).find((b) => b.available_stock >= 1 && b.lauk_available.length >= 1);
  if (!batch) throw new Error("no live batch with lauk within 2 km — reseed the e2e DB");
  return batch;
}

test("a viewed READY ticket still opens offline (service worker), with the chosen lauk", async ({ page, context }) => {
  await registerCustomer(page.request, "Pembeli Tiket");
  const batch = await batchWithLauk(page.request);
  const lauk = batch.lauk_available[0];
  const created = await ok<{ order: OrderDetail }>(
    await checkout(page.request, {
      merchant_id: batch.merchant_id,
      items: [{ batch_id: batch.batch_id, quantity: 1, lauk }],
    }),
  );
  const { order } = await ok<{ order: OrderDetail }>(await page.request.post(`/api/v1/orders/${created.order.id}/simulate-payment`));
  expect(order.pickup_code).toMatch(/^\d{4}$/);
  const code = `SJ-${order.pickup_code}`;

  // Install the SW and make sure it controls the page before viewing the ticket.
  await page.goto("/orders");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  const ticketApi = page.waitForResponse((r) => r.url().endsWith(`/api/v1/orders/${order.id}`) && r.ok());
  await page.goto(`/orders/${order.id}`);
  await ticketApi;
  await expect(page.getByText(code, { exact: true })).toBeVisible();
  await expect(page.getByText(`Lauk: ${lauk}`).first()).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText(code, { exact: true })).toBeVisible();
  await expect(page.getByText(`Lauk: ${lauk}`).first()).toBeVisible();
  await context.setOffline(false);
});
