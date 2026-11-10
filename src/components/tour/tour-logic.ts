/**
 * Pure rules behind /tour (product walkthrough). No React, no DOM globals:
 * unit-tested in tests/unit/tour-logic.test.ts.
 *
 * Steps are 0-based inside the app and 1-based in the URL (?langkah=N) and in
 * every label people read ("Langkah 2 dari 5").
 */

export type TourRole = "pembeli" | "mitra";

export const TOUR_ROLES: readonly TourRole[] = ["pembeli", "mitra"];

/** Visible names of the role options; e2e selects them by these exact names. */
export const TOUR_ROLE_LABELS: Record<TourRole, string> = {
  pembeli: "Pembeli",
  mitra: "Mitra Warung",
};

/** ?peran=mitra opens the merchant track; anything else (or nothing) is the pembeli track. */
export function parseRole(value: string | null | undefined): TourRole {
  return value?.trim().toLowerCase() === "mitra" ? "mitra" : "pembeli";
}

/** Keeps a 0-based step index inside [0, total - 1]; NaN and fractions fall back safely. */
export function clampStep(index: number, total: number): number {
  if (total <= 0) return 0;
  if (!Number.isFinite(index)) return 0;
  return Math.min(total - 1, Math.max(0, Math.trunc(index)));
}

/** ?langkah=N (1-based) to a 0-based index, clamped; missing or invalid opens step 1. */
export function parseStepParam(value: string | null | undefined, total: number): number {
  if (value === null || value === undefined || value.trim() === "") return 0;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return 0;
  return clampStep(n - 1, total);
}

export function nextStep(index: number, total: number): number {
  return clampStep(index + 1, total);
}

export function prevStep(index: number, total: number): number {
  return clampStep(index - 1, total);
}

export function isFirstStep(index: number): boolean {
  return index <= 0;
}

export function isLastStep(index: number, total: number): boolean {
  return index >= total - 1;
}

/** Visible counter, also the polite live region: "Langkah 2 dari 5". */
export function stepCounterLabel(index: number, total: number): string {
  return `Langkah ${index + 1} dari ${total}`;
}

/** aria-label of a slide (role="group", aria-roledescription="slide"): "2 dari 5". */
export function slideAriaLabel(index: number, total: number): string {
  return `${index + 1} dari ${total}`;
}

/** Accessible name of a pagination dot: "Ke langkah 3". */
export function dotAriaLabel(index: number): string {
  return `Ke langkah ${index + 1}`;
}

/** URL kept in sync with the selected track (router.replace, no scroll). */
export function tourHref(role: TourRole): string {
  return `/tour?peran=${role}`;
}

/**
 * "Lewati tur": a guest goes to /welcome; a signed-in user goes to "/", which
 * routes by role. While the session is still unknown (null) it also goes to
 * "/": that router waits for the session and sends a guest who has seen the
 * tour on to /welcome.
 */
export function skipTarget(loggedIn: boolean | null): string {
  return loggedIn === false ? "/welcome" : "/";
}

export type SwipeThresholds = {
  /** Minimum horizontal travel (px) that counts as a swipe on its own. */
  distance: number;
  /** Minimum horizontal speed (px/s) that counts as a flick, even when short. */
  velocity: number;
  /** A flick still has to travel at least this far (px), so a tap with jitter is not a swipe. */
  minFlickDistance: number;
};

export const DEFAULT_SWIPE: SwipeThresholds = { distance: 64, velocity: 450, minFlickDistance: 16 };

/**
 * Swipe decision from a finished drag/pan gesture: 1 = next step (finger moved
 * left), -1 = previous step (finger moved right), 0 = not a swipe. Gestures that
 * travel further vertically than horizontally are scrolls and never count.
 */
export function swipeIntent(
  gesture: { offsetX: number; offsetY?: number; velocityX: number },
  thresholds: SwipeThresholds = DEFAULT_SWIPE,
): -1 | 0 | 1 {
  const { offsetX, velocityX } = gesture;
  const offsetY = gesture.offsetY ?? 0;
  if (!Number.isFinite(offsetX) || !Number.isFinite(velocityX)) return 0;
  if (Math.abs(offsetY) > Math.abs(offsetX)) return 0;

  const far = Math.abs(offsetX) >= thresholds.distance;
  const flick =
    Math.abs(velocityX) >= thresholds.velocity &&
    Math.abs(offsetX) >= thresholds.minFlickDistance &&
    Math.sign(velocityX) === Math.sign(offsetX);
  if (!far && !flick) return 0;
  return offsetX < 0 ? 1 : -1;
}

/** What a key press asks the carousel to do: 1 = next, -1 = previous, 0 = nothing. */
export function arrowKeyIntent(event: {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}): -1 | 0 | 1 {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return 0;
  if (event.key === "ArrowRight") return 1;
  if (event.key === "ArrowLeft") return -1;
  return 0;
}

/** Roles whose own arrow-key behaviour must win over the carousel (radio groups, sliders, tabs…). */
const ARROW_KEY_ROLES = new Set(["radio", "radiogroup", "slider", "tab", "tablist", "menuitem", "option", "listbox", "spinbutton", "textbox", "combobox"]);
const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * True when the focused element uses the arrow keys itself (text fields,
 * radio buttons, sliders…), so the carousel must leave the key alone.
 */
export function targetOwnsArrowKeys(target: {
  tagName?: string;
  isContentEditable?: boolean;
  role?: string | null;
  /** The closest ancestor's explicit role, e.g. a radiogroup wrapper. */
  ancestorRole?: string | null;
}): boolean {
  if (target.isContentEditable) return true;
  if (target.tagName && TYPING_TAGS.has(target.tagName.toUpperCase())) return true;
  if (target.role && ARROW_KEY_ROLES.has(target.role)) return true;
  if (target.ancestorRole && ARROW_KEY_ROLES.has(target.ancestorRole)) return true;
  return false;
}
