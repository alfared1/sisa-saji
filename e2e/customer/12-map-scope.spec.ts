/**
 * /map scopes: every visit opens on all of Indonesia (every warung, grouped
 * into count bubbles at low zoom); picking a city in "Ambil di sekitar" shows
 * only the warung around it; "Seluruh Indonesia" goes back. The stored
 * location (and the pill on other pages) is never replaced by "Seluruh Indonesia".
 */
import { devices, type Locator, type Page } from "@playwright/test";
import { SEED_MERCHANTS } from "../../src/db/seed/data";
import { distanceMeters } from "../../src/lib/campuses";
import { CAMPUSES } from "../../src/lib/constants";
import type { AllMapPinsResponse, MapPinsResponse } from "../../src/lib/contracts";
import { expect, test } from "../fixtures";
import { ok } from "../helpers";

const UGM = CAMPUSES.find((c) => c.id === "ugm")!;
const KOTA_BOGOR = CAMPUSES.find((c) => c.id === "bogor")!;

const groups = (page: Page) => page.locator(".leaflet-marker-icon.ss-group");
const singles = (page: Page) => page.locator(".leaflet-marker-icon.ss-pin, .leaflet-marker-icon.ss-idle");
const livePins = (page: Page) => page.locator(".leaflet-marker-icon[title*='porsi']");
const idleMarkers = (page: Page) => page.locator(".leaflet-marker-icon.ss-idle");

/** "Kota Bogor (Baranangsiang): 10 warung dalam 5 km · …" → { warung: 10, radiusM: 5000 }. */
async function hubRow(row: Locator): Promise<{ warung: number; radiusM: number }> {
  const label = (await row.getAttribute("aria-label")) ?? "";
  const m = /: (\d+) warung dalam (\d+) km/.exec(label);
  expect(m, `hub row label "${label}"`).not.toBeNull();
  return { warung: Number(m![1]), radiusM: Number(m![2]) * 1000 };
}

/** After a hub pick: the map shows exactly the row's warung, all within its radius. */
async function expectHubPick(page: Page, hub: { lat: number; lng: number }, row: { warung: number; radiusM: number }) {
  await expect(livePins(page).first()).toBeAttached();
  await expect.poll(async () => (await livePins(page).count()) + (await idleMarkers(page).count())).toBe(row.warung);
  await expectPinsAround(livePins(page), hub, row.radiusM);
}

/** Warung drawn on the map: group bubble counts + single markers. */
async function warungOnMap(page: Page): Promise<number> {
  const counts = await groups(page)
    .locator(".ss-group__wrap")
    .evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-count"))));
  return counts.reduce((s, n) => s + n, 0) + (await singles(page).count());
}

async function markersOnMap(page: Page): Promise<number> {
  return (await groups(page).count()) + (await singles(page).count());
}

/** Every live pin is a seeded warung within `radiusM` of `center`. */
async function expectPinsAround(pins: Locator, center: { lat: number; lng: number }, radiusM: number) {
  const titles = await pins.evaluateAll((els) => els.map((e) => e.getAttribute("title") ?? ""));
  expect(titles.length).toBeGreaterThan(0);
  for (const t of titles) {
    const name = t.split(": ")[0];
    const seed = SEED_MERCHANTS.find((m) => m.name === name);
    expect(seed, `pin "${name}" is a seeded warung`).toBeDefined();
    expect(distanceMeters(center, seed!), `${name} is within ${radiusM} m`).toBeLessThanOrEqual(radiusM);
  }
  return titles.length;
}

test.describe("map scope (phone)", () => {
  test("opens on all of Indonesia, a city pick shows only its warung, Seluruh Indonesia goes back", async ({
    page,
    request,
  }) => {
    const all = await ok<AllMapPinsResponse>(await request.get("/api/v1/discover/map-pins/all"));
    const slugs = new Set(all.pins.map((p) => p.slug));
    for (const m of SEED_MERCHANTS) expect(slugs.has(m.slug), m.slug).toBe(true);
    expect(all.pins.some((p) => p.live)).toBe(true);

    await page.goto("/map");
    await expect(page.getByRole("button", { name: /^Lokasi: Seluruh Indonesia/ })).toBeVisible();
    await expect(page.locator("[data-map-scope='indonesia']")).toBeAttached();
    // Counts use id-ID grouping ("1.038").
    await expect(page.getByText(/^[\d.]+ warung di [\d.]+ kota$/)).toBeVisible();

    // Every warung is on the map, nationally grouped into a handful of bubbles.
    await expect(groups(page).first()).toBeAttached();
    await expect.poll(() => warungOnMap(page)).toBe(all.pins.length);
    expect(await groups(page).count()).toBeGreaterThanOrEqual(3);
    expect(await markersOnMap(page)).toBeLessThan(all.pins.length);
    await expect(page.locator(".ss-radius")).toHaveCount(0);
    await expect(page.getByText(/^Belum ada surplus dalam/)).toHaveCount(0);

    // Tapping the biggest bubble zooms in and splits it.
    const counts = await groups(page)
      .locator(".ss-group__wrap")
      .evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-count"))));
    const before = await markersOnMap(page);
    await groups(page).nth(counts.indexOf(Math.max(...counts))).dispatchEvent("click");
    await expect.poll(() => markersOnMap(page)).toBeGreaterThan(before);
    await expect.poll(() => warungOnMap(page)).toBe(all.pins.length);

    // Keyboard: Enter on a focused bubble zooms in too, and focus moves into what it split into.
    await page.getByRole("button", { name: "Tampilkan semua warung di peta" }).click();
    await expect.poll(() => markersOnMap(page)).toBe(before);
    await groups(page).first().focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => markersOnMap(page)).toBeGreaterThan(before);
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.classList.contains("leaflet-marker-icon") ?? false))
      .toBe(true);

    // "Ambil di sekitar" → UGM Yogyakarta: only warung within 2 km of UGM.
    await page.getByRole("button", { name: /^Lokasi: / }).click();
    await page.getByRole("dialog", { name: "Lokasi pencarian" }).getByRole("button", { name: "UGM Yogyakarta" }).click();
    await expect(page.getByRole("button", { name: /^Lokasi: UGM Yogyakarta/ })).toBeVisible();
    await expect(page.locator("[data-map-scope='nearby']")).toBeAttached();
    await expect(page.locator(".ss-radius")).toHaveCount(1);
    await expect(groups(page)).toHaveCount(0);

    const radius = await ok<MapPinsResponse>(
      await request.get(`/api/v1/discover/map-pins?lat=${UGM.lat}&lng=${UGM.lng}&radius_m=2000`),
    );
    expect(radius.pins.length).toBeGreaterThan(0);
    await expect(livePins(page)).toHaveCount(radius.pins.length);
    expect(await expectPinsAround(livePins(page), UGM, 2000)).toBe(radius.pins.length);
    await expect(page.getByText(new RegExp(`^${radius.pins.length} warung · [\\d.]+ porsi$`))).toBeVisible();

    // Back to every warung; the stored location stays UGM.
    await page.getByRole("button", { name: "Seluruh Indonesia", exact: true }).click();
    await expect(page.getByRole("button", { name: /^Lokasi: Seluruh Indonesia/ })).toBeVisible();
    await expect(groups(page).first()).toBeAttached();
    await expect(page.locator(".ss-radius")).toHaveCount(0);
    await expect.poll(() => warungOnMap(page)).toBe(all.pins.length);

    await page.getByRole("link", { name: "Beranda" }).click();
    await expect(page).toHaveURL(/\/discover/);
    await expect(page.getByRole("button", { name: /^Lokasi: UGM Yogyakarta/ })).toBeVisible();

    // Client-side navigation back to /map starts on all of Indonesia again.
    await page.getByRole("link", { name: "Peta" }).click();
    await expect(page).toHaveURL(/\/map/);
    await expect(page.getByRole("button", { name: /^Lokasi: Seluruh Indonesia/ })).toBeVisible();
    await expect(groups(page).first()).toBeAttached();
  });

  test("the hub list (Daftar) picks a city; the map shows exactly the row's warung", async ({ page }) => {
    await page.goto("/map");
    // The floating "Pilih kota / lokasi" button opens the same location sheet.
    await page.getByRole("button", { name: "Pilih kota / lokasi" }).click();
    await expect(page.getByRole("dialog", { name: "Lokasi pencarian" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Lokasi pencarian" })).toHaveCount(0);

    await page.getByRole("radio", { name: "Daftar" }).click();
    await expect(page.getByRole("heading", { name: /Bogor/ }).first()).toBeVisible();
    const row = page.getByRole("button", { name: /^Kota Bogor \(Baranangsiang\): \d+ warung dalam/ });
    await expect(row).toBeVisible();
    const counts = await hubRow(row);
    await row.click();

    await expect(page.getByRole("button", { name: /^Lokasi: Kota Bogor/ })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Peta" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("button", { name: `Radius ${counts.radiusM / 1000} km. Ubah radius` })).toBeVisible();
    await expectHubPick(page, KOTA_BOGOR, counts);
  });
});

test.describe("map scope (laptop)", () => {
  // The customer project emulates a Pixel 7; this group renders the lg+ split view.
  test.use({
    viewport: { width: 1366, height: 768 },
    userAgent: devices["Desktop Chrome"].userAgent,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
  });

  test("side panel: hub rows switch to nearby, the back button returns to Indonesia", async ({ page }) => {
    await page.goto("/map");
    const panel = page.locator("aside");
    await expect(panel.getByText("Kota & kampus")).toBeVisible();
    await expect(panel.getByText(/^[\d.]+ warung di [\d.]+ kota · [\d.]+ porsi live$/)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Lokasi: Seluruh Indonesia/ })).toBeVisible();

    const row = panel.getByRole("button", { name: /^Kota Bogor \(Baranangsiang\): / });
    const counts = await hubRow(row);
    await row.click();
    await expect(panel.getByText("Warung terdekat")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Lokasi: Kota Bogor/ })).toBeVisible();
    await expect(page.locator(".ss-radius")).toHaveCount(1);
    await expectHubPick(page, KOTA_BOGOR, counts);

    await panel.getByRole("button", { name: "Seluruh Indonesia", exact: true }).click();
    await expect(panel.getByText("Kota & kampus")).toBeVisible();
    await expect(groups(page).first()).toBeAttached();
    await expect(page.locator(".ss-radius")).toHaveCount(0);
  });
});
