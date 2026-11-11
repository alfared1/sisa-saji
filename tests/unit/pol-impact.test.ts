import { describe, expect, it } from "vitest";
import { formatCo2Kg, formatFoodWeight, impactFigures, impactText } from "@/components/common/impact-text";
import { pinBadge, pinClassName, pinHtml } from "@/components/map/types";

describe("impact text", () => {
  it("formats the reference line for one 200 g portion", () => {
    expect(impactText(200)).toBe("Selamatkan 200 g pangan • −0,5 kg CO₂e");
  });

  it("multiplies portion weight by quantity", () => {
    const f = impactFigures(250, 3);
    expect(f.foodGrams).toBe(750);
    expect(f.co2Grams).toBe(1875);
    expect(f.text).toBe("Selamatkan 750 g pangan • −1,9 kg CO₂e");
  });

  it("switches food weight to kg with a decimal comma from 1 kg", () => {
    expect(formatFoodWeight(999)).toBe("999 g");
    expect(formatFoodWeight(1000)).toBe("1 kg");
    expect(formatFoodWeight(1200)).toBe("1,2 kg");
    expect(formatFoodWeight(12_340)).toBe("12,3 kg");
    expect(impactText(400, 3)).toBe("Selamatkan 1,2 kg pangan • −3,0 kg CO₂e");
  });

  it("always writes CO₂e in kg with a comma, never rounding small values to zero", () => {
    expect(formatCo2Kg(500)).toBe("0,5 kg");
    expect(formatCo2Kg(250)).toBe("0,3 kg");
    expect(formatCo2Kg(50)).toBe("0,05 kg");
    expect(formatCo2Kg(0)).toBe("0,0 kg");
    expect(formatCo2Kg(12_500)).toBe("12,5 kg");
  });

  it("falls back to the default portion weight when unknown", () => {
    expect(impactText(null)).toBe("Selamatkan 200 g pangan • −0,5 kg CO₂e");
    expect(impactText(0, 2)).toBe("Selamatkan 400 g pangan • −1,0 kg CO₂e");
  });
});

describe("map pins use the discount badge rule", () => {
  const NOW = Date.parse("2026-11-08T12:00:00Z");
  const inMin = (m: number) => new Date(NOW + m * 60_000).toISOString();
  const base = { id: "x", lat: 0, lng: 0, name: "Warung", discount_pct: 50, stock: 3, closes_at: inMin(120) };

  it("Hemat (emerald) normally, Flash (orange) at ≥ 70 %, pulsing only < 45 min", () => {
    expect(pinBadge(base, NOW)).toMatchObject({ variant: "hemat", pulse: false, shortLabel: "Hemat 50%" });
    expect(pinBadge({ ...base, discount_pct: 70 }, NOW)).toMatchObject({ variant: "flash", pulse: false });
    expect(pinBadge({ ...base, closes_at: inMin(30) }, NOW)).toMatchObject({
      variant: "flash",
      pulse: true,
      shortLabel: "Flash 50%",
    });
    expect(pinBadge({ ...base, stock: 0 }, NOW)).toBeNull();
    expect(pinBadge({ ...base, discount_pct: 0 }, NOW)).toBeNull();
  });

  it("renders the short label in badge colours with pulse class", () => {
    const b = pinBadge({ ...base, closes_at: inMin(30) }, NOW);
    const html = pinHtml({ ...base, closes_at: inMin(30) }, "urgent", b);
    expect(html).toContain("Flash 50%");
    expect(html).toContain("#C2410C");
    expect(pinClassName("urgent", b, false)).toBe("ss-pin ss-pin--urgent ss-pin--flash ss-pin--pulse");
    expect(pinHtml(base, "deal", pinBadge(base, NOW))).toContain("#047857");
  });
});
