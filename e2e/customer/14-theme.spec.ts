/**
 * Appearance (Terang / Gelap / Sistem): the "Tema tampilan" radiogroup in Akun
 * (/profile, shown to guests too) and the "Ganti tema" header menu on
 * /welcome. A choice applies at once (`.dark` on <html>, every
 * <meta name="theme-color"> on the theme's colour), survives a reload, wins
 * over the OS preference, and "Sistem" follows the OS live. The stored choice
 * is applied by the inline scripts before any app JavaScript runs (no flash).
 * Every test starts in a fresh browser context (empty localStorage, so the
 * default "Sistem").
 */
import { expect, test, type Page } from "@playwright/test";
import { THEME_COLORS } from "../../src/lib/theme";

const GROUP = "Tema tampilan";
type Label = "Terang" | "Gelap" | "Sistem";

const radio = (page: Page, name: Label) =>
  page.getByRole("radiogroup", { name: GROUP, exact: true }).getByRole("radio", { name, exact: true });

const html = (page: Page) => page.locator("html");

async function expectDark(page: Page, dark: boolean) {
  if (dark) await expect(html(page)).toHaveClass(/(^|\s)dark(\s|$)/);
  else await expect(html(page)).not.toHaveClass(/(^|\s)dark(\s|$)/);
}

/**
 * The layout's light/dark pair (exactly two <meta name="theme-color"> tags, never a
 * duplicate) both carry the shown theme's colour.
 */
async function expectThemeColor(page: Page, color: string) {
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute("content")),
      ),
    )
    .toEqual([color, color]);
}

/** Opens Akun and waits for hydration: the stored choice ("Sistem" by default) is only checked after mount. */
async function openProfile(page: Page, checked: Label = "Sistem") {
  await page.goto("/profile");
  await expect(page.getByRole("radiogroup", { name: GROUP, exact: true })).toBeVisible();
  await expect(radio(page, checked)).toBeChecked();
}

async function storedTheme(page: Page): Promise<string | null> {
  return page.evaluate(() => window.localStorage.getItem("theme"));
}

test.describe("theme (Terang / Gelap / Sistem)", () => {
  test("Gelap on a light OS applies at once and survives a reload", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openProfile(page);
    await expectDark(page, false);

    await radio(page, "Gelap").check();
    await expectDark(page, true);
    await expect(radio(page, "Gelap")).toBeChecked();
    await expect(radio(page, "Sistem")).not.toBeChecked();
    await expectThemeColor(page, THEME_COLORS.dark);
    expect(await storedTheme(page)).toBe("dark");

    await page.reload();
    await expect(radio(page, "Gelap")).toBeChecked();
    await expectDark(page, true);
    await expectThemeColor(page, THEME_COLORS.dark);

    // A client-side navigation re-renders the theme-color tags; the bar must stay dark.
    // Wait for the guest card first: until the session settles, the menu rows move down.
    await expect(page.getByText("Masuk ke Sisa-Saji", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: /^Tur aplikasi/ }).click();
    await expect(page).toHaveURL(/\/tour(\?|$)/);
    await expectDark(page, true);
    await expectThemeColor(page, THEME_COLORS.dark);
  });

  test("Terang on a dark OS applies at once and survives a reload", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openProfile(page);
    await expectDark(page, true);

    await radio(page, "Terang").check();
    await expectDark(page, false);
    await expectThemeColor(page, THEME_COLORS.light);
    expect(await storedTheme(page)).toBe("light");

    await page.reload();
    await expect(radio(page, "Terang")).toBeChecked();
    await expectDark(page, false);
    await expectThemeColor(page, THEME_COLORS.light);
  });

  test("Sistem follows the OS preference live", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openProfile(page);
    // Leave the default first, so choosing Sistem is a real change.
    await radio(page, "Gelap").check();
    await expectDark(page, true);

    await radio(page, "Sistem").check();
    expect(await storedTheme(page)).toBe("system");
    await expectDark(page, false);
    await expect(page.getByText("Mengikuti perangkat · saat ini terang", { exact: true })).toBeVisible();

    await page.emulateMedia({ colorScheme: "dark" });
    await expectDark(page, true);
    await expect(page.getByText("Mengikuti perangkat · saat ini gelap", { exact: true })).toBeVisible();
    await expectThemeColor(page, THEME_COLORS.dark);

    await page.emulateMedia({ colorScheme: "light" });
    await expectDark(page, false);
    await expectThemeColor(page, THEME_COLORS.light);
  });

  test("arrow keys move the choice inside the radiogroup", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openProfile(page);
    await radio(page, "Sistem").focus();

    await page.keyboard.press("ArrowLeft");
    await expect(radio(page, "Gelap")).toBeChecked();
    await expect(radio(page, "Gelap")).toBeFocused();
    await expectDark(page, true);

    await page.keyboard.press("ArrowLeft");
    await expect(radio(page, "Terang")).toBeChecked();
    await expectDark(page, false);
  });

  test("the Ganti tema menu on /welcome switches to Gelap", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    // The impact counter is fetched by TanStack Query after hydration: the header is interactive by then.
    const stats = page.waitForResponse((r) => r.url().includes("/api/v1/stats/global"));
    await page.goto("/welcome");
    await stats;
    await expectDark(page, false);

    const toggle = page.getByRole("button", { name: "Ganti tema", exact: true });
    await toggle.click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitemradio", { name: "Sistem", exact: true })).toHaveAttribute("aria-checked", "true");

    await menu.getByRole("menuitemradio", { name: "Gelap", exact: true }).click();
    await expectDark(page, true);
    await expect(menu).toBeHidden();
    expect(await storedTheme(page)).toBe("dark");

    await toggle.click();
    await expect(page.getByRole("menuitemradio", { name: "Gelap", exact: true })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toBeHidden();
  });

  test("a stored choice is applied before any app JavaScript runs (no flash)", async ({ page, context }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await context.addInitScript(() => window.localStorage.setItem("theme", "dark"));
    // Only the inline scripts in the HTML may run: what the first paint gets.
    await context.route(/\/_next\/static\/chunks\/.+\.js(\?|$)/, (route) => route.abort());
    await page.goto("/profile");

    await expectDark(page, true);
    const effective = await page.evaluate(
      () =>
        [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].find((m) =>
          window.matchMedia(m.media || "all").matches,
        )?.content ?? null,
    );
    expect(effective).toBe(THEME_COLORS.dark);
  });
});
