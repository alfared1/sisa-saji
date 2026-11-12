import { devices, request as pwRequest } from "@playwright/test";
import { expect, test } from "../fixtures";
import type { CheckoutResponse, PilotStats } from "../../src/lib/contracts";
import { DEMO_MERCHANT_SLUG, E2E_BASE_URL, E2E_PILOT_CODE } from "../env";
import { db, loginContextAs, ok, pickBatch, registerCustomer } from "../helpers";

/**
 * Field pilot end to end: a real warung joins with the invite code, a customer orders
 * and sees "bayar di warung", the warung verifies the pickup and is told what to
 * charge, reports the night's leftovers, and /uji-coba counts both.
 */
test("pilot warung: join with the code, pay at the warung, verified pickup shows on /uji-coba", async ({ page, context, browser }) => {
  // A seeded Bogor warung (not the shared demo warung) with live surplus tonight.
  const customer = await pwRequest.newContext({ baseURL: E2E_BASE_URL });
  await registerCustomer(customer, "Pembeli Uji Coba");
  const batch = await pickBatch(customer, { excludeMerchantSlug: DEMO_MERCHANT_SLUG, minStock: 1 });
  const ownerEmail = `pilot.${Date.now()}@sisasaji.test`;
  await db().query(
    `update users set email = $1 where id = (select owner_user_id from merchants where slug = $2)`,
    [ownerEmail, batch.merchant_slug],
  );

  // Owner joins the pilot from Pengaturan.
  await loginContextAs(context, ownerEmail);
  await page.goto("/merchant/settings");
  const pilot = page.getByRole("region", { name: "Uji coba lapangan" });
  await pilot.getByLabel("Kode undangan").fill(E2E_PILOT_CODE.toLowerCase());
  await pilot.getByLabel(/biasanya berapa porsi tersisa/).fill("10");
  await pilot.getByRole("button", { name: "Gabung" }).click();
  await expect(pilot.getByText(/Warungmu ikut uji coba/)).toBeVisible();
  await expect(pilot.getByText(/Sebelum uji coba: sekitar 10 porsi/)).toBeVisible();

  // Customer orders: a ticket right away, paid at the warung, no service fee.
  const { order } = await ok<CheckoutResponse>(
    await customer.post("/api/v1/orders/checkout", {
      data: { merchant_id: batch.merchant_id, items: [{ batch_id: batch.batch_id, quantity: 1 }] },
    }),
  );
  expect(order.status).toBe("READY_FOR_PICKUP");
  expect(order.payment_method).toBe("BAYAR_DI_WARUNG");
  expect(order.platform_commission_idr).toBe(0);

  const phoneCtx = await browser.newContext({ ...devices["Pixel 7"], baseURL: E2E_BASE_URL, storageState: await customer.storageState() });
  const phone = await phoneCtx.newPage();
  await phone.goto(`/orders/${order.id}`);
  const payBox = phone.getByRole("region", { name: "Pembayaran di warung" });
  await expect(payBox).toBeVisible();
  await expect(payBox.getByText(/Bayar langsung di warung/)).toBeVisible();
  await phone.goto(`/warung/${batch.merchant_slug}`);
  await expect(phone.getByText("Warung uji coba").first()).toBeVisible();

  // Warung verifies the code and sees what to charge.
  await page.goto("/merchant/orders/scan");
  const pin = page.getByRole("textbox", { name: "Kode pengambilan 4 digit" });
  await pin.click();
  await pin.pressSequentially(order.pickup_code as string);
  const panel = page.getByRole("complementary", { name: "Verifikasi pesanan" });
  await expect(panel.getByText(/^Tagih Rp/)).toBeVisible();
  const verify = page.waitForResponse((r) => r.url().includes(`/orders/${order.id}/verify-pickup`));
  await panel.getByRole("button", { name: "Selesaikan Pesanan" }).click();
  expect((await verify).status()).toBe(200);
  await expect(panel.getByText("diterima langsung")).toBeVisible();

  // After closing: 3 portions given away, 2 thrown away (10 before the pilot → 80% fewer).
  await page.goto("/merchant/dashboard");
  const leftovers = page.getByRole("region", { name: "Sisa setelah tutup" });
  await leftovers.getByRole("button", { name: "Malam ini" }).click();
  await expect(leftovers.getByRole("button", { name: "Malam ini" })).toHaveAttribute("aria-pressed", "true");
  await leftovers.getByRole("textbox", { name: "Porsi dibagikan", exact: true }).fill("3");
  await leftovers.getByRole("textbox", { name: "Porsi dibuang", exact: true }).fill("2");
  await expect(leftovers.getByText(/Total 5 porsi, 3 di antaranya tidak terbuang/)).toBeVisible();
  const saved = page.waitForResponse((r) => r.url().includes("/api/v1/merchant/leftovers") && r.request().method() === "PUT");
  await leftovers.getByRole("button", { name: "Simpan laporan" }).click();
  expect((await saved).status()).toBe(200);
  await expect(leftovers.getByRole("button", { name: "Perbarui laporan" })).toBeVisible();

  // Public results count it, apart from the demo data.
  const stats = await ok<PilotStats>(await customer.get("/api/v1/stats/pilot"));
  expect(stats.portions_rescued).toBeGreaterThanOrEqual(1);
  expect(stats.warung.some((w) => w.slug === batch.merchant_slug && w.portions_rescued >= 1)).toBe(true);
  expect(stats.leftovers).toMatchObject({ nights_reported: 1, donated: 3, discarded: 2, waste_reduction_pct: 80 });
  await phone.goto("/uji-coba");
  await expect(phone.getByRole("heading", { name: "Hasil uji coba di warung sungguhan" })).toBeVisible();
  await expect(phone.getByRole("region", { name: "Hasil uji coba" }).getByText("porsi terselamatkan")).toBeVisible();
  await expect(phone.getByText("Porsi yang dibuang turun 80%")).toBeVisible();

  await phoneCtx.close();
  await customer.dispose();
});
