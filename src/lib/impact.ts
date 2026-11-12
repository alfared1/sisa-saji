import {
  BADGE_TIERS,
  CO2E_PER_KG_FOOD,
  CO2_KG_PER_TREE_YEAR,
  DEFAULT_PORTION_WEIGHT_GRAMS,
} from "./constants";

/** Where CO2E_PER_KG_FOOD comes from, for the "cara menghitung" notes in the UI. */
export const CO2E_SOURCE = {
  label: "FAO (2013), Food Wastage Footprint",
  url: "https://www.fao.org/3/i3347e/i3347e.pdf",
} as const;

/** grams of food saved → grams of CO2e avoided (FAO factor 2.5). */
export function co2GramsFromFoodGrams(foodGrams: number): number {
  return Math.round(foodGrams * CO2E_PER_KG_FOOD);
}

export function foodGramsForPortions(
  portions: number,
  portionWeightGrams: number = DEFAULT_PORTION_WEIGHT_GRAMS,
): number {
  return portions * portionWeightGrams;
}

/** Equivalent number of mature trees absorbing the same CO2 for a year. */
export function treeYearsFromCo2Grams(co2Grams: number): number {
  return co2Grams / 1000 / CO2_KG_PER_TREE_YEAR;
}

export function badgeTierForFoodSaved(foodGrams: number): string {
  let tier: string = BADGE_TIERS[0].tier;
  for (const b of BADGE_TIERS) if (foodGrams >= b.minFoodSavedGrams) tier = b.tier;
  return tier;
}

/** "4,2 kg" — Indonesian decimal comma, one decimal. */
export function formatKg(grams: number): string {
  return `${(grams / 1000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} kg`;
}
