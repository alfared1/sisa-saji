import { expect, test, type Page } from "@playwright/test";
import { freshPhone } from "../helpers";

async function requestCode(page: Page, phone: string) {
  await page.goto("/auth/login");
  await page.getByLabel("Nomor WhatsApp").fill(phone);
  await page.getByRole("button", { name: "Kirim kode OTP" }).click();
  await expect(page).toHaveURL(/\/auth\/verify\?/);
  const banner = page.getByText(/Mode demo — kode OTP: \d{6}/);
  await expect(banner).toBeVisible();
  const code = (await banner.textContent())?.match(/\d{6}/)?.[0];
  expect(code).toBeTruthy();
  return code as string;
}

async function typeOtp(page: Page, code: string) {
  const otp = page.getByRole("textbox", { name: "Kode OTP" });
  await otp.click();
  await otp.pressSequentially(code);
}

test.describe("OTP auth", () => {
  test("new customer signs up with dev code + name, then logs out", async ({ page }) => {
    const phone = freshPhone();
    const code = await requestCode(page, phone);

    // First submit without a name → the form asks for the full name (code not consumed).
    const firstVerify = page.waitForResponse((r) => r.url().includes("/auth/otp/verify"));
    await typeOtp(page, code);
    expect((await firstVerify).status()).toBe(400);
    const name = page.getByPlaceholder("Nama lengkap");
    await expect(name).toBeVisible();
    await name.fill("Sari Uji Coba");
    await page.getByRole("button", { name: "Buat akun & masuk" }).click();

    await expect(page).toHaveURL(/\/discover/);
    await expect(page.getByText(/Akun dibuat\. Selamat datang, Sari!/)).toBeVisible();

    const me = await page.request.get("/api/v1/auth/me");
    const body = (await me.json()) as { data: { user: { full_name: string; role: string } | null } };
    expect(body.data.user?.full_name).toBe("Sari Uji Coba");
    expect(body.data.user?.role).toBe("CUSTOMER");

    // Logout from the profile page.
    await page.goto("/profile");
    await page.getByRole("button", { name: "Keluar" }).first().click();
    await page.getByRole("dialog", { name: "Keluar dari akun?" }).getByRole("button", { name: "Keluar" }).click();
    await expect
      .poll(async () => ((await (await page.request.get("/api/v1/auth/me")).json()) as typeof body).data.user)
      .toBeNull();
  });

  test("wrong OTP code shows an error and keeps the user logged out", async ({ page }) => {
    const code = await requestCode(page, freshPhone());
    const wrong = code === "000000" ? "111111" : "000000";
    await typeOtp(page, wrong);
    await expect(page.getByText(/Kode OTP salah\. Sisa 4 percobaan\./)).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/verify/);
    const me = (await (await page.request.get("/api/v1/auth/me")).json()) as { data: { user: unknown } };
    expect(me.data.user).toBeNull();
  });
});
