/**
 * What the /map page shows (not persisted, so every visit starts fresh):
 *   "indonesia" — every warung nationwide (the default each time /map opens)
 *   "nearby"    — warung within the radius of the stored location
 *
 * Only an explicit pick through "Ambil di sekitar" switches to "nearby": the
 * controls that pick (location sheet campus / GPS / radius, the map's GPS
 * button, a hub row, the radius controls) call `pickLocation()`. Other writes
 * to the location store, such as a background GPS fix Beranda started before
 * the user opened /map, leave the scope alone. Other pages never read this
 * store except LocationPill, which only overrides its label while the map is open.
 */
import { create } from "zustand";

export type MapScope = "indonesia" | "nearby";

export type MapScopeEvent = "open" | "close" | "show-all" | "pick-location";

/** Scope after an event (pure; the store below applies it). */
export function nextMapScope(_scope: MapScope, event: MapScopeEvent): MapScope {
  switch (event) {
    case "pick-location":
      return "nearby";
    case "open":
    case "close":
    case "show-all":
      return "indonesia";
  }
}

type MapScopeState = {
  scope: MapScope;
  /** True while the /map screen is mounted. */
  mapOpen: boolean;
  /**
   * Bumped each time /map is left. Next keeps a left page alive in a hidden
   * <Activity>, whose effect cleanup removes the Leaflet map; keying the map on
   * this gives the next visit a fresh Leaflet instance instead of a removed one.
   */
  visits: number;
  openMap: () => void;
  closeMap: () => void;
  showAll: () => void;
  /** The user picked a location or radius through "Ambil di sekitar"; only an open /map reacts. */
  pickLocation: () => void;
};

export const useMapScopeStore = create<MapScopeState>()((set) => ({
  scope: "indonesia",
  mapOpen: false,
  visits: 0,
  openMap: () => set((s) => ({ mapOpen: true, scope: nextMapScope(s.scope, "open") })),
  // Reset on leave too, so the next visit never renders one frame of the old scope.
  closeMap: () => set((s) => ({ mapOpen: false, scope: nextMapScope(s.scope, "close"), visits: s.visits + 1 })),
  showAll: () => set((s) => ({ scope: nextMapScope(s.scope, "show-all") })),
  pickLocation: () => set((s) => (s.mapOpen ? { scope: nextMapScope(s.scope, "pick-location") } : s)),
}));

/** True when the map is open in the nationwide scope (LocationPill reads "Seluruh Indonesia"). */
export const selectShowsIndonesia = (s: MapScopeState) => s.mapOpen && s.scope === "indonesia";
