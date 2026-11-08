import { expect, test } from "../fixtures";
import { registerCustomer } from "../helpers";

/** Dev guide: ≤3-step quick order — discover → menu card → "Pesan & Ambil Sendiri" → QRIS. */
test("quick order reaches QRIS within 3 screens, then pays to a pickup ticket", async ({ page }) => {
  await registerCustomer(page.request, "Raka Cepat");

  // Screen 1: /discover
  await page.goto("/discover");
  const card = page.getByRole("button", { name: /^Lihat detail / }).first();
  await expect(card).toBeVisible();
  const menuName = ((await card.getAttribute("aria-label")) ?? "").replace("Lihat detail ", "");

  // Screen 2: quick-order sheet
  await card.click();
  const sheet = page.getByRole("dialog", { name: menuName });
  await expect(sheet).toBeVisible();
  const checkout = page.waitForResponse((r) => r.url().includes("/api/v1/orders/checkout"));
  await sheet.getByRole("button", { name: "Pesan & Ambil Sendiri" }).click();
  expect((await checkout).status()).toBe(201);

  // Screen 3: payment page with a dynamic QRIS.
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("img", { name: /^QRIS pembayaran / })).toBeVisible();
  await expect(page.getByText("Selesaikan pembayaran dalam")).toBeVisible();

  // Demo payment → pickup ticket.
  await page.getByRole("button", { name: /Simulasi Bayar/ }).click();
  await expect(page.getByText(/^SJ-\d{4}$/)).toBeVisible();
  await expect(page.getByText("Kode pengambilan", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: /QR/ }).first()).toBeVisible();
});
