import { expect, test } from "@playwright/test";
import { freshPhone } from "../helpers";

test("fresh merchant: OTP login → 5-step onboarding wizard → dashboard", async ({ page }) => {
  const phone = freshPhone();
  await page.goto("/auth/login?role=MERCHANT");
  await expect(page.getByRole("heading", { name: "Masuk sebagai Mitra Warung" })).toBeVisible();
  await page.getByLabel("Nomor WhatsApp").fill(phone);
  await page.getByRole("button", { name: "Kirim kode OTP" }).click();
  const banner = page.getByText(/Mode demo — kode OTP: \d{6}/);
  await expect(banner).toBeVisible();
  const code = ((await banner.textContent()) ?? "").match(/\d{6}/)?.[0] as string;

  const otp = page.getByRole("textbox", { name: "Kode OTP" });
  await otp.click();
  await otp.pressSequentially(code);
  await page.getByPlaceholder("Nama lengkap").fill("Bu Wati Uji");
  await page.getByRole("button", { name: "Buat akun & masuk" }).click();
  await expect(page).toHaveURL(/\/merchant\/onboarding/);

  const next = () => page.getByRole("button", { name: /^Lanjut/ }).click();
  const TITLES = ["Kenalkan warungmu", "Di mana warungmu?", "Jam operasional", "Pencairan dana", "Menu pertama"];
  const stepLine = (n: number) => page.getByRole("heading", { name: TITLES[n - 1], exact: true });

  await expect(stepLine(1)).toBeVisible();
  await page.getByPlaceholder("Warung Makan Bu Sri").fill(`Warung Uji ${phone.slice(-4)}`);
  await page.getByRole("textbox", { name: "Nomor WhatsApp warung" }).fill(phone);
  await next();

  await expect(stepLine(2)).toBeVisible();
  // "Ketuk peta untuk menaruh pin lokasi warung" — drop the pin in the map centre.
  const map = page.locator(".leaflet-container").first();
  await expect(map).toBeVisible();
  const box = await map.boundingBox();
  if (!box) throw new Error("map has no box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.6);
  await expect(page.getByText("Taruh pin lokasi warung di peta")).toBeHidden();
  await page.getByPlaceholder(/Jl\. Pogung Kidul/).fill("Jl. Kaliurang Km 5 No. 9, Sleman");
  await next();

  await expect(stepLine(3)).toBeVisible();
  await next();

  await expect(stepLine(4)).toBeVisible();
  await page.getByRole("button", { name: "Lewati", exact: true }).click();

  await expect(stepLine(5)).toBeVisible();
  await page.getByPlaceholder("Nasi Ayam Goreng Lengkuas").fill("Nasi Telur Uji");
  await page.getByPlaceholder("18.000").fill("15000");
  await page.getByPlaceholder("5.500").fill("6000");
  const done = page.waitForResponse((r) => r.url().includes("/api/v1/merchant/onboarding"));
  await page.getByRole("button", { name: /Selesai & buka dasbor/ }).click();
  expect((await done).status()).toBeLessThan(300);

  await expect(page).toHaveURL(/\/merchant\/dashboard/);
  await expect(page.getByText(`Warung Uji ${phone.slice(-4)}`).first()).toBeVisible();
});
