import { expect, test } from "../fixtures";
import type { CheckoutResponse, MerchantSummary } from "../../src/lib/contracts";
import { nearby, registerCustomer } from "../helpers";

const digits = (s: string | null) => Number((s ?? "").replace(/\D/g, ""));

test("cart: two items, DiffMerchantDialog guard, voucher HEMAT2K + lunchbox, pay → ticket", async ({ page }) => {
  await registerCustomer(page.request, "Dewi Keranjang");
  const { merchants } = await nearby(page.request);
  // A warung with two live menus whose combined price reaches HEMAT2K's Rp 10.000 minimum.
  const main = merchants.find(
    (m) =>
      m.batches.filter((b) => b.available_stock >= 1).length >= 2 &&
      m.batches[0].selling_price_idr + m.batches[1].selling_price_idr >= 10_000,
  ) as MerchantSummary;
  expect(main, "need a warung with 2 live menus").toBeTruthy();
  const other = merchants.find((m) => m.id !== main.id && m.batches.some((b) => b.available_stock >= 1)) as MerchantSummary;
  const [a, b] = main.batches;

  await page.goto(`/warung/${main.slug}`);
  await page.getByRole("button", { name: `Tambah ${a.menu_name} ke keranjang` }).click();
  await page.getByRole("button", { name: `Tambah ${b.menu_name} ke keranjang` }).click();
  const cartBar = page.getByRole("link", { name: /^Keranjang: 2 item/ }).or(page.getByRole("button", { name: /^Keranjang: 2 item/ }));
  await expect(cartBar).toBeVisible();

  // Another warung → guard dialog; "Batal" keeps the original cart.
  await page.goto(`/warung/${other.slug}`);
  await page.getByRole("button", { name: `Tambah ${other.batches[0].menu_name} ke keranjang` }).click();
  const guard = page.getByRole("alertdialog", { name: "Ganti warung?" });
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: "Batal" }).click();
  await expect(guard).toBeHidden();
  await expect(cartBar).toBeVisible();

  await cartBar.click();
  await expect(page).toHaveURL(/\/checkout/);

  // Voucher HEMAT2K.
  await page.getByRole("button", { name: /Pakai voucher/ }).click();
  await page.getByRole("button", { name: /HEMAT2K/ }).click();
  await expect(page.getByText("Voucher HEMAT2K")).toBeVisible();

  // Bring own lunchbox.
  await page.getByRole("switch", { name: "Bawa wadah sendiri" }).click();
  const thanks = page.getByRole("dialog", { name: "Terima kasih sudah bawa wadah sendiri" });
  await expect(thanks).toBeVisible();
  await thanks.getByRole("button", { name: "Oke, mengerti" }).click();

  // UI totals: subtotal + Rp 1.500 − Rp 2.000.
  const row = (label: string | RegExp) => page.locator("dl > div").filter({ has: page.locator("dt", { hasText: label }) }).locator("dd");
  const subtotal = digits(await row("Subtotal Harga Pemulihan").textContent());
  expect(subtotal).toBe(a.selling_price_idr + b.selling_price_idr);
  expect(digits(await row("Biaya layanan").textContent())).toBe(1500);
  expect(digits(await row("Voucher HEMAT2K").textContent())).toBe(2000);
  expect(digits(await row("Total bayar").textContent())).toBe(subtotal + 1500 - 2000);

  const created = page.waitForResponse((r) => r.url().includes("/api/v1/orders/checkout") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Lanjut Bayar" }).click();
  const res = await created;
  expect(res.status()).toBe(201);
  const { order } = ((await res.json()) as { data: CheckoutResponse }).data;
  expect(order.items).toHaveLength(2);
  expect(order.uses_own_lunchbox).toBe(true);
  expect(order.subtotal_recovery_idr).toBe(subtotal);
  expect(order.platform_commission_idr).toBe(1500);
  expect(order.voucher_discount_idr).toBe(2000);
  expect(order.total_customer_paid_idr).toBe(subtotal + 1500 - 2000);
  expect(order.net_merchant_payout_idr).toBe(subtotal);

  await expect(page).toHaveURL(new RegExp(`/orders/${order.id}$`));
  await page.getByRole("button", { name: /Simulasi Bayar/ }).click();
  await expect(page.getByText(/^SJ-\d{4}$/)).toBeVisible();
});
