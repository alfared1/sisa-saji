import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";

const liveLine = (page: Page) => page.getByText(/^Live · \d+ menu, \d+ porsi dalam/);

async function liveMenuCount(page: Page): Promise<number> {
  const text = (await liveLine(page).textContent()) ?? "";
  return Number(text.match(/Live · (\d+) menu/)?.[1] ?? NaN);
}

test.describe("discovery", () => {
  test("sections render, category filter narrows, radius 2 → 5 km adds warung", async ({ page }) => {
    const first = page.waitForResponse((r) => r.url().includes("/api/v1/discover/nearby") && r.ok());
    await page.goto("/discover");
    await first;

    await expect(liveLine(page)).toContainText("2 km");
    await expect(page.getByRole("heading", { name: "Mitra Terdekat" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Hampir Habis & Diskon Tertinggi" })).toBeVisible();
    const at2km = await liveMenuCount(page);
    expect(at2km).toBeGreaterThan(0);
    await expect(page.getByText("Pecel Lele Mas Bejo")).toHaveCount(0);

    // Category filter: Vegan only.
    const chips = page.getByRole("radiogroup", { name: "Kategori" });
    await chips.getByRole("radio", { name: "Vegan" }).click();
    await expect(chips.getByRole("radio", { name: "Vegan" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText("Hijau Daun").first()).toBeVisible();
    await expect(page.getByText(/Bakmi Jawa/)).toHaveCount(0);
    await chips.getByRole("radio", { name: "Semua" }).click();
    await expect(page.getByText(/Bakmi Jawa/).first()).toBeVisible();

    // Radius 2 → 5 km: more results, Seturan / Condongcatur warung appear.
    const wider = page.waitForResponse((r) => r.url().includes("radius_m=5000") && r.ok());
    await page.getByRole("button", { name: /^Radius 2 km/ }).click();
    await page.getByRole("menuitemradio", { name: "5 km" }).click();
    await wider;
    await expect(liveLine(page)).toContainText("5 km");
    await expect.poll(() => liveMenuCount(page)).toBeGreaterThan(at2km);
    await expect(page.getByText("Pecel Lele Mas Bejo").first()).toBeVisible();
    await expect(page.getByText("Dapur Mama Kost").first()).toBeVisible();
  });

  test("map shows pins and opens the warung bottom sheet", async ({ page }) => {
    await page.goto("/map");
    const pins = page.locator(".leaflet-marker-icon[title*='porsi']");
    // Leaflet DivIcon roots are 0×0 boxes (the pill is an overflowing child), so
    // assert attachment and dispatch the click Leaflet listens for.
    await expect(pins.first()).toBeAttached();
    expect(await pins.count()).toBeGreaterThanOrEqual(5);

    const title = (await pins.first().getAttribute("title")) ?? "";
    const merchantName = title.split(":")[0];
    await pins.first().dispatchEvent("click");
    const sheet = page.getByRole("dialog", { name: merchantName });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("button", { name: /^Pesan / }).first()).toBeVisible();
  });
});
