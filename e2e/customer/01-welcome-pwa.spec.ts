import { expect, test } from "@playwright/test";

test.describe("welcome + PWA", () => {
  test("welcome page shows the shared impact counter", async ({ page }) => {
    const stats = page.waitForResponse((r) => r.url().includes("/api/v1/stats/global") && r.ok());
    await page.goto("/welcome");
    await stats;
    const impact = page.getByRole("region", { name: "Dampak Sisa-Saji" });
    await expect(impact).toBeVisible();
    await expect(impact.getByText("pangan diselamatkan")).toBeVisible();
    await expect(impact.getByText("pesanan diambil")).toBeVisible();
    await expect(impact.getByText(/menu live malam ini/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Masuk" }).first()).toBeVisible();
  });

  test("manifest and icons are served", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.status()).toBe(200);
    const manifest = (await res.json()) as { name: string; start_url: string; display: string; icons: { src: string }[] };
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
    for (const icon of manifest.icons) {
      const img = await request.get(icon.src);
      expect(img.status(), icon.src).toBe(200);
      expect(img.headers()["content-type"]).toContain("image/png");
    }
  });

  test("service worker registers and activates in production", async ({ page }) => {
    await page.goto("/welcome");
    const scope = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return reg.active ? reg.scope : null;
    });
    expect(scope).toBe(new URL("/", page.url()).href);
    const sw = await page.request.get("/sw.js");
    expect(sw.status()).toBe(200);
  });
});
