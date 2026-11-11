import { devices, request as pwRequest } from "@playwright/test";
import { expect, test } from "../fixtures";
import type { ImpactSummary } from "../../src/lib/contracts";
import { DEMO_MERCHANT_EMAIL, DEMO_MERCHANT_SLUG, E2E_BASE_URL } from "../env";
import { createPaidOrder, db, loginContextAs, ok, pickBatch } from "../helpers";

async function unusedCode(merchantSlug: string): Promise<string> {
  const { rows } = await db().query<{ pickup_code: string }>(
    `select o.pickup_code from orders o join merchants m on m.id = o.merchant_id
      where m.slug = $1 and o.status in ('PENDING_PAYMENT','PAID','READY_FOR_PICKUP')`,
    [merchantSlug],
  );
  const used = new Set(rows.map((r) => r.pickup_code));
  for (let i = 1000; i < 10000; i++) if (!used.has(String(i))) return String(i);
  throw new Error("no unused pickup code");
}

test("merchant verifies a customer's SJ code; customer sees COMPLETED, reviews, impact grows", async ({ page, context, browser }) => {
  // Customer: fresh account with a paid (READY_FOR_PICKUP) order at the demo warung.
  const customer = await pwRequest.newContext({ baseURL: E2E_BASE_URL });
  const batch = await pickBatch(customer, { merchantSlug: DEMO_MERCHANT_SLUG });
  const order = await createPaidOrder(customer, batch);
  expect(order.status).toBe("READY_FOR_PICKUP");
  const before = await ok<ImpactSummary>(await customer.get("/api/v1/profile/impact"));
  expect(before.completed_orders).toBe(0);

  // Merchant: scan page, manual PIN.
  await loginContextAs(context, DEMO_MERCHANT_EMAIL);
  await page.goto("/merchant/orders/scan");
  const pin = page.getByRole("textbox", { name: "Kode pengambilan 4 digit" });
  await expect(pin).toBeVisible();

  // Wrong PIN → inline error.
  await pin.click();
  await pin.pressSequentially(await unusedCode(DEMO_MERCHANT_SLUG));
  await expect(page.getByRole("alert").filter({ hasText: "Kode tidak ditemukan" })).toBeVisible();

  // Correct PIN → order review → complete.
  await pin.click();
  await pin.pressSequentially(order.pickup_code as string);
  const panel = page.getByRole("complementary", { name: "Verifikasi pesanan" });
  await expect(panel.getByText(order.order_number).first()).toBeVisible();
  const verify = page.waitForResponse((r) => r.url().includes(`/orders/${order.id}/verify-pickup`));
  await panel.getByRole("button", { name: "Selesaikan Pesanan" }).click();
  expect((await verify).status()).toBe(200);
  await expect(panel.getByText("Pesanan selesai!")).toBeVisible();

  // Customer device: order page turns COMPLETED with the celebration dialog.
  const customerCtx = await browser.newContext({
    ...devices["Pixel 7"],
    baseURL: E2E_BASE_URL,
    storageState: await customer.storageState(),
  });
  const phone = await customerCtx.newPage();
  await phone.goto(`/orders/${order.id}`);
  const celebration = phone.getByRole("dialog", { name: "Pesanan selesai!" });
  await expect(celebration).toBeVisible();
  await celebration.getByRole("button", { name: "Beri ulasan" }).click();

  const review = phone.getByRole("dialog", { name: "Gimana pesananmu?" });
  await expect(review).toBeVisible();
  await review.getByRole("radio", { name: "5 bintang" }).click();
  const sent = phone.waitForResponse((r) => r.url().includes(`/orders/${order.id}/review`));
  await review.getByRole("button", { name: "Kirim ulasan" }).click();
  expect((await sent).status()).toBe(200);
  await expect(phone.getByText("Ulasanmu terkirim")).toBeVisible();

  // Impact totals increased (API + /impact page).
  const after = await ok<ImpactSummary>(await customer.get("/api/v1/profile/impact"));
  expect(after.completed_orders).toBe(1);
  expect(after.total_food_saved_grams).toBeGreaterThan(before.total_food_saved_grams);
  expect(after.total_co2_avoided_grams).toBeGreaterThan(before.total_co2_avoided_grams);
  await phone.goto("/impact");
  await expect(phone.getByRole("region", { name: "Total dampak" }).getByText(/Dari 1 pesanan selesai/)).toBeVisible();

  await customerCtx.close();
  await customer.dispose();
});
