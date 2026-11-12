import { describe, expect, it } from "vitest";
import { confidenceText, selloutText } from "@/components/merchant/dashboard/forecast-text";

describe("forecast card sentences", () => {
  it("words the sell-out chance as an estimate, n of 10 nights", () => {
    expect(selloutText(0.7)).toBe("Dengan diskon 50%, porsi sisa diperkirakan habis di sekitar 7 dari 10 malam seperti ini.");
    expect(selloutText(0.14)).toContain("sekitar 1 dari 10 malam");
    for (const p of [0, 0.04, 0.3, 0.55, 0.96, 1]) {
      const s = selloutText(p);
      expect(s).toContain("diperkirakan");
      expect(s).not.toMatch(/biasanya/);
    }
  });

  it("handles the ends and bad input without odd numbers", () => {
    expect(selloutText(1)).toBe("Dengan diskon 50%, porsi sisa diperkirakan hampir selalu habis.");
    expect(selloutText(0.97)).toBe(selloutText(1));
    expect(selloutText(0)).toBe("Dengan diskon 50%, porsi sisa diperkirakan jarang habis.");
    expect(selloutText(0.03)).toBe(selloutText(0));
    expect(selloutText(Number.NaN)).toBe(selloutText(0));
    expect(selloutText(1.4)).toBe(selloutText(1));
    expect(selloutText(-0.2)).toBe(selloutText(0));
  });

  it("confidence bands", () => {
    expect(confidenceText(0.8)).toMatch(/cukup bisa dipegang/);
    expect(confidenceText(0.6)).toMatch(/^Perkiraan kasar/);
    expect(confidenceText(0.2)).toMatch(/^Masih kasar/);
  });
});
