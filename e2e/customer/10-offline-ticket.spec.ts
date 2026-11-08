import { expect, test } from "../fixtures";
import { createPaidOrder, pickBatch } from "../helpers";

test("a viewed READY ticket still opens offline (service worker)", async ({ page, context }) => {
  const order = await createPaidOrder(page.request, await pickBatch(page.request));
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

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText(code, { exact: true })).toBeVisible();
  await context.setOffline(false);
});
