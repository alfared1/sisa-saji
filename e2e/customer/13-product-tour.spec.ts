/**
 * /tour — product walkthrough: a first-time guest opening "/" lands on the
 * tour; "Lanjut"/"Kembali", the dots and ArrowLeft/ArrowRight move through the
 * steps (counter + h2 change, focus follows the h2); ?peran=mitra opens the
 * merchant track and ?langkah=N deep-links (clamped). Finishing, skipping or
 * any final CTA stores "ss-tour-seen", after which "/" sends a guest to
 * /welcome; reopening the tour by client-side navigation starts over at step 1.
 * Every test starts in a fresh browser context (empty localStorage).
 */
import { expect, test, type Page } from "@playwright/test";
import { DEMO_CUSTOMER_EMAIL } from "../env";
import { loginContextAs } from "../helpers";

const ROLE_GROUP = "Pilih peran";

const carousel = (page: Page) => page.getByRole("region", { name: "Tur Sisa-Saji", exact: true });

/** The slide labelled "<n> dari <total>". */
const slide = (page: Page, n: number, total: number) =>
  carousel(page).getByRole("group", { name: `${n} dari ${total}`, exact: true });

const slideTitle = (page: Page, n: number, total: number) => slide(page, n, total).getByRole("heading", { level: 2 });

/** Visible "Langkah <n> dari <total>" counter (the aria-live text may repeat it). */
const counter = (page: Page, n: number, total: number) =>
  page.getByText(`Langkah ${n} dari ${total}`, { exact: true }).filter({ visible: true }).first();

const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

/** "Saya pemilik warung" / "Saya pembeli" may be a link or a button. */
const control = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true }).or(page.getByRole("link", { name, exact: true }));

/** Option of the "Pilih peran" switch (radiogroup or tablist). */
function roleOption(page: Page, name: "Pembeli" | "Mitra Warung", selected?: boolean) {
  const radio = page
    .getByRole("radiogroup", { name: ROLE_GROUP, exact: true })
    .getByRole("radio", { name, exact: true, ...(selected === undefined ? {} : { checked: selected }) });
  const tab = page
    .getByRole("tablist", { name: ROLE_GROUP, exact: true })
    .getByRole("tab", { name, exact: true, ...(selected === undefined ? {} : { selected }) });
  return radio.or(tab);
}

async function expectTrack(page: Page, name: "Pembeli" | "Mitra Warung") {
  await expect(roleOption(page, name, true)).toHaveCount(1);
}

/** Reads <total> from the visible "Langkah 1 dari <total>" counter. */
async function totalSteps(page: Page): Promise<number> {
  const text = page.getByText(/^Langkah \d+ dari \d+$/).filter({ visible: true }).first();
  await expect(text).toBeVisible();
  const total = Number(/dari (\d+)$/.exec((await text.textContent())?.trim() ?? "")?.[1]);
  expect(total, "step total").toBeGreaterThan(1);
  return total;
}

async function tourSeenFlag(page: Page): Promise<string | null> {
  return page.evaluate(() => window.localStorage.getItem("ss-tour-seen"));
}

/** Opens a tour URL and waits until the carousel is on step 1 (or the deep-linked step). */
async function openTour(page: Page, url = "/tour"): Promise<number> {
  await page.goto(url);
  const region = carousel(page);
  await expect(region).toBeVisible();
  await expect(region).toHaveAttribute("aria-roledescription", "carousel");
  return totalSteps(page);
}

test.describe("product tour", () => {
  test("a first-time guest opening / lands on the tour (pembeli track, step 1)", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/tour(\?|$)/);
    await expect(carousel(page)).toHaveAttribute("aria-roledescription", "carousel");
    const total = await totalSteps(page);

    await expect(counter(page, 1, total)).toBeVisible();
    await expect(slide(page, 1, total)).toHaveAttribute("aria-roledescription", "slide");
    await expect(slideTitle(page, 1, total)).toBeVisible();
    await expectTrack(page, "Pembeli");
    await expect(roleOption(page, "Mitra Warung")).toHaveCount(1);
    await expect(button(page, "Lewati tur")).toBeVisible();
    await expect(button(page, "Kembali")).toBeHidden();
    await expect(button(page, "Ke langkah 1")).toHaveAttribute("aria-current", "step");
    // Only opening the tour does not count as having seen it.
    expect(await tourSeenFlag(page)).toBeNull();
  });

  test("Lanjut walks every pembeli step; the final CTA goes to /discover", async ({ page }) => {
    const total = await openTour(page);
    const titles = [((await slideTitle(page, 1, total).textContent()) ?? "").trim()];

    for (let n = 2; n <= total; n++) {
      await button(page, "Lanjut").click();
      await expect(counter(page, n, total)).toBeVisible();
      const title = slideTitle(page, n, total);
      await expect(title).toBeVisible();
      // On phones the last step trades the dots for the final links, so check them before it.
      if (n < total) {
        await expect(button(page, `Ke langkah ${n}`)).toHaveAttribute("aria-current", "step");
        await expect(button(page, `Ke langkah ${n - 1}`)).not.toHaveAttribute("aria-current", "step");
      }
      titles.push(((await title.textContent()) ?? "").trim());
    }
    expect(new Set(titles).size, `distinct step titles: ${titles.join(" | ")}`).toBe(total);

    // "Kembali" and the dots move both ways.
    await expect(button(page, "Kembali")).toBeVisible();
    await button(page, "Kembali").click();
    await expect(counter(page, total - 1, total)).toBeVisible();
    await button(page, `Ke langkah ${total}`).click();
    await expect(counter(page, total, total)).toBeVisible();

    // Last pembeli step: final CTAs.
    await expect(page.getByRole("link", { name: "Masuk atau daftar", exact: true })).toHaveAttribute("href", "/auth/login");
    await expect(control(page, "Saya pemilik warung")).toBeVisible();
    const start = page.getByRole("link", { name: "Mulai cari makanan", exact: true });
    await expect(start).toHaveAttribute("href", "/discover");
    await start.click();
    await expect(page).toHaveURL(/\/discover(\?|$)/);
    expect(await tourSeenFlag(page)).toBe("1");
  });

  test("Lewati tur goes to /welcome, and / then opens /welcome instead of the tour", async ({ page }) => {
    await openTour(page);
    await button(page, "Lewati tur").click();
    await expect(page).toHaveURL(/\/welcome(\?|$)/);
    expect(await tourSeenFlag(page)).toBe("1");

    await page.goto("/");
    await expect(page).toHaveURL(/\/welcome(\?|$)/);
  });

  test("?peran=mitra opens the merchant track; its final CTA is merchant sign-up", async ({ page }) => {
    const total = await openTour(page);
    const pembeliFirst = ((await slideTitle(page, 1, total).textContent()) ?? "").trim();

    const mitraTotal = await openTour(page, "/tour?peran=mitra");
    await expectTrack(page, "Mitra Warung");
    await expect(counter(page, 1, mitraTotal)).toBeVisible();
    const mitraFirst = slideTitle(page, 1, mitraTotal);
    await expect(mitraFirst).toBeVisible();
    expect(((await mitraFirst.textContent()) ?? "").trim()).not.toBe(pembeliFirst);

    // ?langkah is 1-based and clamped to the last step.
    await openTour(page, "/tour?peran=mitra&langkah=99");
    await expectTrack(page, "Mitra Warung");
    await expect(counter(page, mitraTotal, mitraTotal)).toBeVisible();
    await expect(page.getByRole("link", { name: "Daftar jadi mitra", exact: true })).toHaveAttribute(
      "href",
      "/auth/login?role=MERCHANT",
    );
    // Only opening a deep link to the last step does not count as finishing the tour.
    expect(await tourSeenFlag(page)).toBeNull();

    // "Saya pembeli" switches tracks and drops peran=mitra from the URL.
    await control(page, "Saya pembeli").click();
    await expectTrack(page, "Pembeli");
    await expect(page).not.toHaveURL(/peran=mitra/);

    // The role switch keeps ?peran in sync the other way too.
    await roleOption(page, "Mitra Warung").click();
    await expectTrack(page, "Mitra Warung");
    await expect(page).toHaveURL(/[?&]peran=mitra(&|$)/);

    await openTour(page, "/tour?peran=mitra&langkah=99");
    await page.getByRole("link", { name: "Daftar jadi mitra", exact: true }).click();
    await expect(page).toHaveURL(/\/auth\/login\?role=MERCHANT/);
    expect(await tourSeenFlag(page)).toBe("1");
  });

  test("ArrowRight/ArrowLeft move the tour while focus is inside it; focus follows the h2", async ({ page }) => {
    const total = await openTour(page, "/tour?langkah=1");
    await slideTitle(page, 1, total).focus();
    await expect(slideTitle(page, 1, total)).toBeFocused();

    await page.keyboard.press("ArrowRight");
    await expect(counter(page, 2, total)).toBeVisible();
    await expect(slideTitle(page, 2, total)).toBeFocused();

    await page.keyboard.press("ArrowRight");
    await expect(counter(page, 3, total)).toBeVisible();
    await expect(slideTitle(page, 3, total)).toBeFocused();

    await page.keyboard.press("ArrowLeft");
    await expect(counter(page, 2, total)).toBeVisible();
    await expect(slideTitle(page, 2, total)).toBeFocused();
  });

  test("a logged-in customer who skips goes through / to /discover", async ({ page, context }) => {
    await loginContextAs(context, DEMO_CUSTOMER_EMAIL);
    await openTour(page);
    // Whether or not /auth/me has answered yet, "Lewati tur" goes through "/", which routes by session.
    await button(page, "Lewati tur").click();
    await expect(page).toHaveURL(/\/discover(\?|$)/);
    expect(await tourSeenFlag(page)).toBe("1");
  });

  test("reopening the tour by client-side navigation starts again at step 1", async ({ page }) => {
    const total = await openTour(page);
    await button(page, "Lanjut").click();
    await button(page, "Lanjut").click();
    await expect(counter(page, 3, total)).toBeVisible();

    await button(page, "Lewati tur").click();
    await expect(page).toHaveURL(/\/welcome(\?|$)/);
    // A link click (no reload): Next brings back the /tour it kept alive, which must not resume at step 3.
    await page.getByRole("link", { name: "Lihat tur 1 menit", exact: true }).click();
    await expect(page).toHaveURL(/\/tour(\?|$)/);
    await expect(counter(page, 1, total)).toBeVisible();
    await expect(slideTitle(page, 1, total)).toBeVisible();
    await expectTrack(page, "Pembeli");
  });

  test("/welcome and the profile menu link to the tour", async ({ page }) => {
    await page.goto("/welcome");
    await page.getByRole("link", { name: "Lihat tur 1 menit", exact: true }).click();
    await expect(page).toHaveURL(/\/tour(\?|$)/);
    await expect(carousel(page)).toBeVisible();

    await page.goto("/profile");
    // Wait for the guest card: until the session settles, the menu rows move down under the bottom nav.
    await expect(page.getByText("Masuk ke Sisa-Saji", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: /^Tur aplikasi/ }).click();
    await expect(page).toHaveURL(/\/tour(\?|$)/);
    await expect(carousel(page)).toBeVisible();
  });
});
