import { devices } from "@playwright/test";
import { expect, test } from "../fixtures";
import { DEMO_MERCHANT_EMAIL, DEMO_MERCHANT_NAME, DEMO_MERCHANT_SLUG, E2E_BASE_URL } from "../env";
import { loginContextAs } from "../helpers";

const MENU = "Paket Kejutan Teh Euis";

test("merchant publishes surplus with the AI quote; it appears on dashboard and for customers", async ({ page, context, browser }) => {
  await loginContextAs(context, DEMO_MERCHANT_EMAIL);

  await page.goto("/merchant/dashboard");
  await expect(page.getByRole("region", { name: "Perkiraan surplus malam ini" })).toBeVisible();

  await page.goto("/merchant/surplus/new");
  const menus = page.getByRole("radiogroup", { name: "Pilih menu" });
  const firstQuote = page.waitForResponse((r) => r.url().includes("/merchant/surplus/quote-ai") && r.ok());
  await menus.getByRole("radio", { name: new RegExp(MENU) }).click();
  await firstQuote;

  // Stepper changes trigger a fresh AI quote with the new stock.
  const stock = page.getByRole("group", { name: "Jumlah porsi" });
  const before = Number(await stock.getByRole("spinbutton").or(stock.getByRole("textbox")).first().inputValue());
  const requoted = page.waitForResponse(
    (r) =>
      r.url().includes("/merchant/surplus/quote-ai") &&
      r.ok() &&
      (JSON.parse(r.request().postData() ?? "{}") as { available_stock?: number }).available_stock === before + 1,
  );
  await stock.getByRole("button", { name: "Tambah Jumlah porsi" }).click();
  await requoted;
  await expect(page.getByRole("img", { name: /^Peluang habis terjual \d+ persen/ })).toBeVisible();
  await expect(page.getByRole("list", { name: "Jadwal diskon" })).toBeVisible();

  const publish = page.waitForResponse((r) => r.url().includes("/merchant/surplus/publish"));
  await page.getByRole("button", { name: /Publikasikan Sekarang/ }).click();
  expect((await publish).status()).toBe(201);
  await expect(page.getByRole("heading", { name: "Listing aktif!" })).toBeVisible();

  await page.goto("/merchant/dashboard");
  await expect(page.getByRole("heading", { name: MENU, level: 3 }).first()).toBeVisible();

  // Customer (guest, mobile) sees it at the same warung.
  const phoneCtx = await browser.newContext({ ...devices["Pixel 7"], baseURL: E2E_BASE_URL });
  const phone = await phoneCtx.newPage();
  await phone.goto("/discover");
  await phone.getByPlaceholder("Cari nasi, soto, roti…").fill(MENU);
  // Search matches the menu; the result is grouped under its warung card.
  await expect(phone.getByText(/^Live · [1-9]\d* menu/)).toBeVisible();
  await expect(phone.getByText(DEMO_MERCHANT_NAME).first()).toBeVisible();
  await phone.goto(`/warung/${DEMO_MERCHANT_SLUG}`);
  await expect(phone.getByRole("article", { name: MENU }).first()).toBeVisible();
  await phoneCtx.close();
});
