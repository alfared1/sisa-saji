/**
 * Appearance (Terang / Gelap / Sistem). next-themes stores the choice per
 * device in localStorage under THEME_STORAGE_KEY and toggles `.dark` on
 * <html>; the default is "system" (follow prefers-color-scheme). This file is
 * the pure part: options, the browser-bar colours, the helper line and guards.
 */

export type ThemeChoice = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

/** next-themes' default storage key (kept so existing visitors keep their choice). */
export const THEME_STORAGE_KEY = "theme";

export const DEFAULT_THEME: ThemeChoice = "system";

/**
 * Browser / PWA bar colour per resolved theme: the page background of each
 * theme (--background in globals.css, as sRGB hex; a unit test keeps them in
 * step). Used by the viewport metadata in src/app/layout.tsx and by
 * ThemeColorSync when the choice differs from the OS.
 */
export const THEME_COLORS = {
  light: "#fbf8f3",
  dark: "#0b110e",
} as const satisfies Record<ResolvedTheme, string>;

export type ThemeIconName = "sun" | "moon" | "device";

export type ThemeOption = { value: ThemeChoice; label: string; icon: ThemeIconName };

/** Display order of the switcher and the quick menu. */
export const THEME_OPTIONS: readonly ThemeOption[] = [
  { value: "light", label: "Terang", icon: "sun" },
  { value: "dark", label: "Gelap", icon: "moon" },
  { value: "system", label: "Sistem", icon: "device" },
];

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === "light" || value === "dark" || value === "system";
}

export function isResolvedTheme(value: unknown): value is ResolvedTheme {
  return value === "light" || value === "dark";
}

export function themeLabel(choice: ThemeChoice): string {
  return THEME_OPTIONS.find((o) => o.value === choice)?.label ?? choice;
}

/** The bar colour for a resolved theme; anything unknown falls back to light. */
export function themeColorFor(resolved: string | undefined): string {
  return resolved === "dark" ? THEME_COLORS.dark : THEME_COLORS.light;
}

/**
 * Helper line under the switcher. `resolvedTheme` is what the page shows now
 * (for "system": what the device asks for). Returns "" while the choice is
 * still unknown (server render and the hydration pass), so the line can keep
 * its height without showing a wrong state.
 */
export function themeHint(theme: string | undefined, resolvedTheme: string | undefined): string {
  if (!isThemeChoice(theme)) return "";
  if (theme === "light") return "Tetap terang, siang maupun malam";
  if (theme === "dark") return "Tetap gelap, nyaman di mata saat malam";
  if (resolvedTheme === "dark") return "Mengikuti perangkat · saat ini gelap";
  if (resolvedTheme === "light") return "Mengikuti perangkat · saat ini terang";
  return "Mengikuti pengaturan perangkat";
}

/**
 * Inline script for the root layout. It runs before first paint (like
 * next-themes' own script), so a hard reload with "Gelap" on a light OS never
 * shows a light browser bar. It switches the `media` of the light/dark
 * <meta name="theme-color"> pair ("all" for the chosen colour, "not all" for
 * the other) and leaves `content` alone: React finds these tags by `content`
 * when it hydrates, and an edited one would be duplicated. "system" (or
 * nothing stored) keeps the media-query pair as rendered.
 *
 * Any other stored value (an old or hand-edited one) is removed. next-themes
 * accepts any string and would put it on <html> as a class (no `.dark`, an
 * empty switcher); this script runs before next-themes' own (it comes first
 * in <body>), so next-themes then falls back to the default, Sistem.
 */
export function themeColorBootScript(): string {
  const key = JSON.stringify(THEME_STORAGE_KEY);
  const colors = JSON.stringify(THEME_COLORS);
  return `(function(){try{var t=localStorage.getItem(${key});if(t!=="light"&&t!=="dark"){if(t!==null&&t!=="system")localStorage.removeItem(${key});return}var c=${colors}[t];var m=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<m.length;i++)m[i].setAttribute("media",m[i].getAttribute("content")===c?"all":"not all")}catch(e){}})();`;
}
