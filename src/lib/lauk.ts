/**
 * Menu contents ("isi porsi") and lauk helpers, shared by the server (publish, checkout) and
 * the buyer app. Pure and client-safe.
 *
 * Model: a menu lists fixed `contents` and optional `lauk_options` (the buyer picks one). A
 * batch stores tonight's `lauk_available`, a subset of the options. Lauk have no stock of
 * their own; the batch portion is the only unit that is reserved.
 */
import type { MenuCategory } from "@/lib/contracts";

const itemKey = (s: string) => s.toLocaleLowerCase("id-ID");

/** Trims, collapses inner spaces, drops empty entries and case-insensitive repeats; keeps order. */
export function normalizeItems(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const item = raw.trim().replace(/\s+/g, " ");
    if (!item) continue;
    const key = itemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** The entry of `list` equal to `value` ignoring case and extra spaces, in the list's casing. */
export function findItem(list: readonly string[], value: string): string | null {
  const key = itemKey(value.trim().replace(/\s+/g, " "));
  return list.find((item) => itemKey(item) === key) ?? null;
}

/** Every entry of `sub` is in `of` (ignoring case). */
export function isSubset(sub: readonly string[], of: readonly string[]): boolean {
  return sub.every((item) => findItem(of, item) !== null);
}

/** The lauk preselected for the buyer: the first one still available, or null. */
export function defaultLauk(batch: { lauk_available: readonly string[] }): string | null {
  return batch.lauk_available[0] ?? null;
}

/** Lauk the menu offers that are gone tonight, in menu order. */
export function laukSoldOut(batch: { lauk_options: readonly string[]; lauk_available: readonly string[] }): string[] {
  return batch.lauk_options.filter((option) => findItem(batch.lauk_available, option) === null);
}

/** Label for the choice: meals pick a lauk, everything else (roti, minuman) a variant. */
export function laukLabel(category: MenuCategory): "Pilih lauk" | "Pilih varian" {
  return category === "MAKANAN_BERAT" || category === "MAKANAN_VEGAN" ? "Pilih lauk" : "Pilih varian";
}

/** Noun for the static single-option line and the ticket ("Lauk: Ayam goreng"). */
export function laukNoun(category: MenuCategory): "Lauk" | "Varian" {
  return laukLabel(category) === "Pilih lauk" ? "Lauk" : "Varian";
}

/**
 * Identity of a cart line: one batch with one lauk. Branded so a plain batch id cannot be
 * passed where a line key is expected.
 */
export type LineKey = string & { readonly __lineKey: true };

export function lineKey(batchId: string, lauk: string | null | undefined): LineKey {
  return `${batchId}|${lauk ?? ""}` as LineKey;
}
