import { expect, test } from "../fixtures";
import type { CheckoutBody, CheckoutResponse } from "../../src/lib/contracts";
import { DEMO_MERCHANT_SLUG } from "../env";
import { nearby, registerCustomer } from "../helpers";

/** ≤ 3-step quick order (docs/ARCHITECTURE.md): discover → menu card → "Kunci Porsi Sekarang" → QRIS. */
test("quick order reaches QRIS within 3 screens, then pays to a pickup ticket", async ({ page }) => {
  await registerCustomer(page.request, "Raka Cepat");

  // Screen 1: /discover
  await page.goto("/discover");
  const card = page.getByRole("button", { name: /^Lihat detail / }).first();
  await expect(card).toBeVisible();
  const menuName = ((await card.getAttribute("aria-label")) ?? "").replace("Lihat detail ", "");

  // Screen 2: quick-order sheet (QRIS Instan is the default payment).
  await card.click();
  const sheet = page.getByRole("dialog", { name: menuName });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("radio", { name: "QRIS Instan" })).toHaveAttribute("aria-checked", "true");
  await expect(sheet.getByText("Porsi dikunci 10 menit sampai kamu bayar.")).toBeVisible();
  const checkout = page.waitForResponse((r) => r.url().includes("/api/v1/orders/checkout"));
  await sheet.getByRole("button", { name: "Kunci Porsi Sekarang" }).click();
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

test("demo warung: pick a lauk, pay cash at the warung, get a ticket that holds the portion", async ({ page }) => {
  await registerCustomer(page.request, "Sinta Lauk");
  const { merchants } = await nearby(page.request);
  const demo = merchants.find((m) => m.slug === DEMO_MERCHANT_SLUG);
  const batch = demo?.batches.find((b) => b.available_stock >= 1 && b.lauk_available.length >= 2);
  expect(batch, "the demo warung needs a live menu with at least 2 lauk tonight").toBeTruthy();
  if (!batch) return;
  const [firstLauk, secondLauk] = batch.lauk_available;

  await page.goto(`/warung/${DEMO_MERCHANT_SLUG}`);
  await page.getByRole("button", { name: `Lihat detail ${batch.menu_name}` }).click();
  const sheet = page.getByRole("dialog", { name: batch.menu_name });
  await expect(sheet).toBeVisible();

  // The lauk picker preselects the first lauk still available.
  const picker = sheet.getByRole("radiogroup", { name: /^Pilih (lauk|varian)$/ });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole("radio", { name: firstLauk, exact: true })).toHaveAttribute("aria-checked", "true");
  await picker.getByRole("radio", { name: secondLauk, exact: true }).click();
  await expect(picker.getByRole("radio", { name: secondLauk, exact: true })).toHaveAttribute("aria-checked", "true");

  // Cash at the warung: hold copy only on this path, no service fee.
  await sheet.getByRole("radiogroup", { name: "Cara bayar" }).getByRole("radio", { name: "Tunai di warung" }).click();
  await expect(sheet.getByText(/Porsi ditahan 30 menit/)).toBeVisible();
  await expect(sheet.getByText("Porsi dikunci 10 menit sampai kamu bayar.")).toHaveCount(0);

  const created = page.waitForResponse((r) => r.url().includes("/api/v1/orders/checkout") && r.request().method() === "POST");
  await sheet.getByRole("button", { name: "Kunci Porsi Sekarang" }).click();
  const res = await created;
  const sent = res.request().postDataJSON() as CheckoutBody;
  expect(sent.payment_method).toBe("BAYAR_DI_WARUNG");
  expect(sent.items).toEqual([{ batch_id: batch.batch_id, quantity: 1, lauk: secondLauk }]);
  expect(res.status()).toBe(201);
  const { order } = ((await res.json()) as { data: CheckoutResponse }).data;
  expect(order.status).toBe("READY_FOR_PICKUP");
  expect(order.platform_commission_idr).toBe(0);
  expect(order.items[0].lauk).toBe(secondLauk);

  await expect(page).toHaveURL(new RegExp(`/orders/${order.id}$`));
  await expect(page.getByText("Porsi dikunci untukmu")).toBeVisible();
  await expect(page.getByRole("region", { name: "Pembayaran di warung" })).toBeVisible();
  await expect(page.getByText(`Lauk: ${secondLauk}`).first()).toBeVisible();
});
