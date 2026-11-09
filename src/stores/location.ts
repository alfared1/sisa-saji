/**
 * Discovery location + radius. Defaults to IPB Dramaga, Bogor (CAMPUSES[0], the
 * platform's home base) so the app works before / without geolocation permission.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { CAMPUSES, DEFAULT_SEARCH_RADIUS_M, EXPANDED_RADIUS_OPTIONS_M, type CampusId } from "@/lib/constants";
import { persistStorage } from "@/lib/pwa/storage";

export type LocationSource = "gps" | "campus" | "manual";
export type RadiusOption = (typeof EXPANDED_RADIUS_OPTIONS_M)[number];
export const RADIUS_OPTIONS: readonly RadiusOption[] = EXPANDED_RADIUS_OPTIONS_M;

export type LocationValue = {
  lat: number;
  lng: number;
  label: string;
  source: LocationSource;
  campus_id: CampusId | null;
  /** ISO timestamp of the last update (GPS freshness). */
  updated_at: string | null;
};

type LocationState = LocationValue & {
  radius_m: RadiusOption;
  setLocation: (loc: { lat: number; lng: number; label?: string; source: LocationSource }) => void;
  setCampus: (id: CampusId) => void;
  setRadius: (radius: number) => void;
  reset: () => void;
};

const DEFAULT_CAMPUS = CAMPUSES[0];

export const DEFAULT_LOCATION: LocationValue = {
  lat: DEFAULT_CAMPUS.lat,
  lng: DEFAULT_CAMPUS.lng,
  label: DEFAULT_CAMPUS.name,
  source: "campus",
  campus_id: DEFAULT_CAMPUS.id,
  updated_at: null,
};

function toRadius(r: number): RadiusOption {
  return RADIUS_OPTIONS.find((o) => o === r) ?? DEFAULT_SEARCH_RADIUS_M;
}

export const useLocationStore = create<LocationState>()(
  persist(
    (set) => ({
      ...DEFAULT_LOCATION,
      radius_m: DEFAULT_SEARCH_RADIUS_M,

      setLocation: ({ lat, lng, label, source }) =>
        set({
          lat,
          lng,
          source,
          campus_id: null,
          label: label ?? (source === "gps" ? "Lokasi kamu saat ini" : "Titik pilihan"),
          updated_at: new Date().toISOString(),
        }),

      setCampus: (id) => {
        const c = CAMPUSES.find((x) => x.id === id);
        if (!c) return;
        set({
          lat: c.lat,
          lng: c.lng,
          label: c.name,
          source: "campus",
          campus_id: c.id,
          updated_at: new Date().toISOString(),
        });
      },

      setRadius: (radius) => set({ radius_m: toRadius(radius) }),

      reset: () => set({ ...DEFAULT_LOCATION, radius_m: DEFAULT_SEARCH_RADIUS_M }),
    }),
    {
      name: "ss-location",
      // v2: the default point moved from UGM to IPB Dramaga. A location the user never
      // chose (updated_at null) follows the new default; a chosen one is kept, with a
      // chosen campus's label refreshed to its current name ("IPB Bogor" was renamed).
      version: 2,
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<LocationState>;
        if (version < 2 && !state.updated_at) return { ...state, ...DEFAULT_LOCATION } as LocationState;
        const campus = state.source === "campus" ? CAMPUSES.find((c) => c.id === state.campus_id) : undefined;
        if (version < 2 && campus) return { ...state, label: campus.name } as LocationState;
        return state as LocationState;
      },
      storage: persistStorage(),
      skipHydration: true,
      partialize: (s) => ({
        lat: s.lat,
        lng: s.lng,
        label: s.label,
        source: s.source,
        campus_id: s.campus_id,
        updated_at: s.updated_at,
        radius_m: s.radius_m,
      }),
    },
  ),
);

export function formatRadius(radiusM: number): string {
  return radiusM >= 1000
    ? `${(radiusM / 1000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} km`
    : `${radiusM} m`;
}
