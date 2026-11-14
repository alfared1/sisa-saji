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
    // Default point is IPB Dramaga; Sindang Barang / Loji are ~3.7 / ~4.7 km away.
    await expect(page.getByText("Nasi Timbel Ceu Iyah")).toHaveCount(0);

    // Category filter: Vegan only.
    const chips = page.getByRole("radiogroup", { name: "Kategori" });
    await chips.getByRole("radio", { name: "Vegan" }).click();
    await expect(chips.getByRole("radio", { name: "Vegan" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText("Saung Hejo").first()).toBeVisible();
    await expect(page.getByText(/Kang Dadan/)).toHaveCount(0);
    await chips.getByRole("radio", { name: "Semua" }).click();
    await expect(page.getByText(/Kang Dadan/).first()).toBeVisible();

    // Radius 2 → 5 km: more results, Sindang Barang / Loji warung appear.
    const wider = page.waitForResponse((r) => r.url().includes("radius_m=5000") && r.ok());
    await page.getByRole("button", { name: /^Radius 2 km/ }).click();
    await page.getByRole("menuitemradio", { name: "5 km" }).click();
    await wider;
    await expect(liveLine(page)).toContainText("5 km");
    await expect.poll(() => liveMenuCount(page)).toBeGreaterThan(at2km);
    await expect(page.getByText("Nasi Timbel Ceu Iyah").first()).toBeVisible();
    await expect(page.getByText("Laksa & Asinan Bu Nining").first()).toBeVisible();
  });

  test("quick filters: walking distance and the ceban price narrow the menus; no surprise category", async ({ page }) => {
    const first = page.waitForResponse((r) => r.url().includes("/api/v1/discover/nearby") && r.ok());
    await page.goto("/discover");
    await first;
    await expect(liveLine(page)).toContainText("2 km");
    const all = await liveMenuCount(page);

    // Closed surprise items are gone from the category filter.
    const categories = page.getByRole("radiogroup", { name: "Kategori" });
    await expect(categories.getByRole("radio", { name: "Semua" })).toBeVisible();
    await expect(categories.getByRole("radio", { name: "Paket Kejutan" })).toHaveCount(0);

    const quick = page.getByRole("group", { name: "Filter cepat" });
    const near = quick.getByRole("button", { name: "< 500 m" });
    const mid = quick.getByRole("button", { name: "< 1 km" });

    // "< 500 m": the live line counts within 500 m, every matching card is a walk away.
    await near.click();
    await expect(near).toHaveAttribute("aria-pressed", "true");
    await expect(liveLine(page)).toContainText("500 m");
    expect(await liveMenuCount(page)).toBeLessThanOrEqual(all);
    const matches = page.getByRole("region", { name: "Menu yang Cocok" });
    await expect(matches).toBeVisible();
    const distances = await matches.locator("article").evaluateAll((els) =>
      els.map((e) => Number(/(\d+) m · jalan kaki/.exec(e.textContent ?? "")?.[1] ?? NaN)),
    );
    expect(distances.length).toBeGreaterThan(0);
    for (const d of distances) expect(d).toBeLessThan(500);

    // The distance chips are one choice.
    await mid.click();
    await expect(mid).toHaveAttribute("aria-pressed", "true");
    await expect(near).toHaveAttribute("aria-pressed", "false");
    await expect(liveLine(page)).toContainText("1 km");
    await mid.click();
    await expect(liveLine(page)).toContainText("2 km");

    // "Harga ≤ Rp 12.000": every matching card sells at most Rp 12.000.
    const cheap = quick.getByRole("button", { name: "Harga ≤ Rp 12.000" });
    await cheap.click();
    await expect(cheap).toHaveAttribute("aria-pressed", "true");
    await expect(matches).toBeVisible();
    // The selling price is the lowest "Rp" amount on a card (the struck-through one is higher).
    const prices = await matches.locator("article").evaluateAll((els) =>
      els.map((e) => {
        const amounts = [...(e.textContent ?? "").matchAll(/Rp\s?([\d.]+)/g)].map((m) => Number(m[1].replace(/\./g, "")));
        return Math.min(...amounts);
      }),
    );
    expect(prices.length).toBeGreaterThan(0);
    for (const p of prices) expect(p).toBeLessThanOrEqual(12000);
    await cheap.click();
    await expect(page.getByRole("heading", { name: "Hampir Habis & Diskon Tertinggi" })).toBeVisible();
  });

  test("map shows pins and opens the warung bottom sheet", async ({ page }) => {
    await page.goto("/map");
    // /map opens on all of Indonesia; re-picking the stored campus (IPB Dramaga)
    // in "Ambil di sekitar" switches to the 2 km radius pins.
    await expect(page.getByRole("button", { name: /^Lokasi: Seluruh Indonesia/ })).toBeVisible();
    await page.getByRole("button", { name: /^Lokasi: / }).click();
    await page.getByRole("dialog", { name: "Lokasi pencarian" }).getByRole("button", { name: "IPB Dramaga, Bogor" }).click();
    await expect(page.getByRole("button", { name: /^Lokasi: IPB Dramaga, Bogor/ })).toBeVisible();

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
