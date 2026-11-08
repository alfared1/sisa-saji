/**
 * Per-item impact copy (dev guide §7): "🌱 Selamatkan 200 g pangan • −0,5 kg CO₂e".
 * Pure, unit-tested in tests/unit/pol-impact.test.ts.
 */
import { DEFAULT_PORTION_WEIGHT_GRAMS } from "@/lib/constants";
import { co2GramsFromFoodGrams } from "@/lib/impact";

/** "200 g" under 1 kg, else "1,2 kg" (Indonesian decimal comma, max 1 decimal). */
export function formatFoodWeight(grams: number): string {
  const g = Math.max(0, Math.round(grams));
  if (g < 1000) return `${g} g`;
  return `${(g / 1000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} kg`;
}

/** CO₂e always in kg with a decimal comma: 500 → "0,5 kg", 50 → "0,05 kg", 2500 → "2,5 kg". */
export function formatCo2Kg(grams: number): string {
  const kg = Math.max(0, grams) / 1000;
  const digits = kg > 0 && kg < 0.1 ? 2 : 1;
  return `${kg.toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: digits })} kg`;
}

export type ImpactFigures = { foodGrams: number; co2Grams: number; food: string; co2: string; text: string };

/** Impact of `quantity` portions of `portionWeightGrams` each. */
export function impactFigures(
  portionWeightGrams: number | null | undefined,
  quantity = 1,
): ImpactFigures {
  const weight = portionWeightGrams && portionWeightGrams > 0 ? portionWeightGrams : DEFAULT_PORTION_WEIGHT_GRAMS;
  const foodGrams = weight * Math.max(0, quantity);
  return impactFiguresFromGrams(foodGrams);
}

export function impactFiguresFromGrams(foodGrams: number): ImpactFigures {
  const co2Grams = co2GramsFromFoodGrams(foodGrams);
  const food = formatFoodWeight(foodGrams);
  const co2 = formatCo2Kg(co2Grams);
  return { foodGrams, co2Grams, food, co2, text: `🌱 Selamatkan ${food} pangan • −${co2} CO₂e` };
}

/** "🌱 Selamatkan 200 g pangan • −0,5 kg CO₂e" */
export function impactText(portionWeightGrams: number | null | undefined, quantity = 1): string {
  return impactFigures(portionWeightGrams, quantity).text;
}
