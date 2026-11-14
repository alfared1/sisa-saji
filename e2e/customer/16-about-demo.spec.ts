import { expect, test } from "@playwright/test";

/** /tentang: the one-page overview, and one tap into the demo buyer and demo warung. */
test.describe("about page + demo login", () => {
  test("explains the product with its sources and SDGs", async ({ page }) => {
    await page.goto("/welcome");
    await page.getByRole("link", { name: "Tentang" }).click();
    await expect(page).toHaveURL(/\/tentang$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("terjual sebelum");
    for (const name of ["Masalahnya", "Riset pengguna", "Cara kerjanya", "Dampak yang dihitung", "Teknologi di baliknya", "Model bisnis", "Sumber"]) {
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    }
    await expect(page.getByText("SDG 12.3", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /FAO \(2013\)/ }).first()).toHaveAttribute("href", /fao\.org/);
  });

  test("login: an empty number explains itself, and the demo account signs in with one tap", async ({ page }) => {
    await page.goto("/auth/login?next=%2Fdiscover");
    await page.getByRole("button", { name: "Kirim kode OTP" }).click();
    await expect(page.getByText(/Nomor HP tidak valid/)).toBeVisible();
    await page.getByRole("button", { name: "Masuk dengan akun demo pembeli" }).click();
    await expect(page).toHaveURL(/\/discover/);
  });

  test("one tap opens the demo warung, another the demo buyer", async ({ browser, baseURL }) => {
    const warung = await browser.newContext({ baseURL });
    const wp = await warung.newPage();
    await wp.goto("/tentang");
    await wp.getByRole("button", { name: "Coba sebagai warung" }).click();
    await expect(wp).toHaveURL(/\/merchant\/dashboard/);
    await expect(wp.getByRole("region", { name: "Sisa setelah tutup" })).toBeVisible();
    await warung.close();

    const buyer = await browser.newContext({ baseURL });
    const bp = await buyer.newPage();
    await bp.goto("/tentang");
    await bp.getByRole("button", { name: "Coba sebagai pembeli" }).click();
    await expect(bp).toHaveURL(/\/discover/);
    const me = await bp.request.get("/api/v1/auth/me");
    expect(((await me.json()) as { data: { user: { email: string } } }).data.user.email).toBe("demo.pembeli@sisasaji.test");
    await buyer.close();
  });
});
