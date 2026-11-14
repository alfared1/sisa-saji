import { devices } from "@playwright/test";
import { expect, test } from "../fixtures";
import { DEMO_MERCHANT_EMAIL, DEMO_MERCHANT_NAME, DEMO_MERCHANT_SLUG, E2E_BASE_URL } from "../env";
import { loginContextAs } from "../helpers";

// The demo warung's menu with listed contents and four lauk options (seed).
const MENU = "Nasi Rames Teh Euis + 1 Lauk";
const LAUK_OFF = "Telur balado";
const LAUK_LEFT = ["Ayam bakar", "Ikan asin peda", "Perkedel jagung"];
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("merchant publishes surplus with the suggested price; it appears on dashboard and for customers", async ({ page, context, browser }) => {
  await loginContextAs(context, DEMO_MERCHANT_EMAIL);

  await page.goto("/merchant/dashboard");
  await expect(page.getByRole("region", { name: "Perkiraan surplus malam ini" })).toBeVisible();

  await page.goto("/merchant/surplus/new");
  const menus = page.getByRole("radiogroup", { name: "Pilih menu" });
  const firstQuote = page.waitForResponse((r) => r.url().includes("/merchant/surplus/quote-ai") && r.ok());
  await menus.getByRole("radio", { name: new RegExp(escapeRegex(MENU)) }).click();
  await firstQuote;

  // Tonight's lauk: all on by default; switch one off.
  const lauk = page.getByRole("group", { name: "Lauk yang masih ada malam ini" });
  for (const item of [...LAUK_LEFT, LAUK_OFF]) await expect(lauk.getByRole("button", { name: item })).toHaveAttribute("aria-pressed", "true");
  await lauk.getByRole("button", { name: LAUK_OFF }).click();
  await expect(lauk.getByRole("button", { name: LAUK_OFF })).toHaveAttribute("aria-pressed", "false");

  // Stock changes trigger a fresh quote. Pick an explicit amount first: the field is prefilled
  // from tonight's forecast once it loads, so reading it straight away races that prefill.
  const quotedFor = (n: number) =>
    page.waitForResponse(
      (r) =>
        r.url().includes("/merchant/surplus/quote-ai") &&
        r.ok() &&
        (JSON.parse(r.request().postData() ?? "{}") as { available_stock?: number }).available_stock === n,
    );
  const picked = quotedFor(10);
  await page.getByRole("group", { name: "Pilih cepat jumlah porsi" }).getByRole("button", { name: "10", exact: true }).click();
  await picked;
  const requoted = quotedFor(11);
  await page.getByRole("group", { name: "Jumlah porsi" }).getByRole("button", { name: "Tambah Jumlah porsi" }).click();
  await requoted;
  await expect(page.getByRole("img", { name: /^Peluang habis terjual \d+ persen/ })).toBeVisible();
  await expect(page.getByRole("list", { name: "Jadwal diskon" })).toBeVisible();

  // Optional photo of the display case: compressed on the device, uploaded after publishing.
  const photoDataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#c58b3a";
      ctx.fillRect(0, 0, 320, 240);
    }
    return canvas.toDataURL("image/jpeg", 0.8);
  });
  await page.getByLabel("Ambil foto etalase").setInputFiles({
    name: "etalase.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(photoDataUrl.split(",")[1] ?? "", "base64"),
  });
  await expect(page.getByRole("img", { name: "Pratinjau foto etalase" })).toBeVisible();

  const publish = page.waitForResponse((r) => r.url().includes("/merchant/surplus/publish"));
  const photoUpload = page.waitForResponse((r) => /\/merchant\/surplus\/[^/]+\/photo$/.test(new URL(r.url()).pathname) && r.request().method() === "POST");
  await page.getByRole("button", { name: /Publikasikan Sekarang/ }).click();
  const published = await publish;
  expect(published.status()).toBe(201);
  expect(published.request().postDataJSON()).toMatchObject({ lauk_available: LAUK_LEFT, full_portion: true });
  await expect(page.getByRole("heading", { name: "Surplus sudah tayang" })).toBeVisible();
  await expect(page.getByText(`Lauk malam ini: ${LAUK_LEFT.join(", ")}`)).toBeVisible();
  expect((await photoUpload).status()).toBe(201);
  await expect(page.getByText(/^Foto terunggah pukul \d{2}\.\d{2}$/)).toBeVisible();

  await page.goto("/merchant/dashboard");
  await expect(page.getByRole("heading", { name: MENU, level: 3 }).first()).toBeVisible();

  // Customer (guest, mobile) sees it at the same warung.
  const phoneCtx = await browser.newContext({ ...devices["Pixel 7"], baseURL: E2E_BASE_URL });
  const phone = await phoneCtx.newPage();
  await phone.goto("/discover");
  await phone.getByPlaceholder("Cari nasi, soto, roti…").fill("Nasi Rames Teh Euis");
  // Search matches the menu; the result is grouped under its warung card.
  await expect(phone.getByText(/^Live · [1-9]\d* menu/)).toBeVisible();
  await expect(phone.getByText(DEMO_MERCHANT_NAME).first()).toBeVisible();
  await phone.goto(`/warung/${DEMO_MERCHANT_SLUG}`);
  await expect(phone.getByRole("article", { name: MENU }).first()).toBeVisible();
  await phoneCtx.close();
});
