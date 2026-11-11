"use client";

import { CheckIcon, EarthIcon, LocateFixedIcon, Loader2Icon } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useGeolocation } from "@/hooks/use-geolocation";
import { cn } from "@/lib/utils";
import { RADIUS_OPTIONS, formatRadius, useLocationStore } from "@/stores/location";
import { selectShowsIndonesia, useMapScopeStore } from "@/stores/map-scope";
import { CampusPicker } from "./campus-picker";

/**
 * Bottom sheet: use GPS, choose the radius, or pick a campus / city quick-location.
 * On /map it also offers "Seluruh Indonesia"; there every pick (including the
 * campus already chosen) switches the map to that area (src/stores/map-scope.ts),
 * and while the map shows all of Indonesia no campus, GPS or radius reads as chosen.
 */
export function LocationSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { request, isLocating } = useGeolocation();
  const source = useLocationStore((s) => s.source);
  const campusId = useLocationStore((s) => s.campus_id);
  const radius = useLocationStore((s) => s.radius_m);
  const label = useLocationStore((s) => s.label);
  const setCampus = useLocationStore((s) => s.setCampus);
  const setRadius = useLocationStore((s) => s.setRadius);
  const mapOpen = useMapScopeStore((s) => s.mapOpen);
  const allIndonesia = useMapScopeStore(selectShowsIndonesia);
  const showAll = useMapScopeStore((s) => s.showAll);
  const pickLocation = useMapScopeStore((s) => s.pickLocation);
  const gpsActive = source === "gps" && !allIndonesia;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-w-md rounded-t-3xl">
        <DrawerHeader className="text-left">
          <DrawerTitle className="text-lg font-bold">Lokasi pencarian</DrawerTitle>
          <DrawerDescription>
            {mapOpen
              ? "Lihat seluruh Indonesia, atau pilih kampus / lokasimu untuk surplus di sekitarnya."
              : "Kami tampilkan surplus makanan di sekitar titik ini."}
          </DrawerDescription>
        </DrawerHeader>
        <div className="min-h-0 space-y-5 overflow-y-auto overscroll-contain px-4 pb-6">
          {mapOpen && (
            <button
              type="button"
              aria-pressed={allIndonesia}
              onClick={() => {
                showAll();
                onOpenChange(false);
              }}
              className={cn(
                "flex w-full items-center gap-3 rounded-2xl p-3 text-left ring-1 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                allIndonesia ? "bg-brand-soft ring-primary/40" : "bg-card ring-border hover:bg-muted",
              )}
            >
              <span className="inline-flex size-10 items-center justify-center rounded-xl bg-foreground text-background">
                <EarthIcon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">Seluruh Indonesia</span>
                <span className="block text-xs text-muted-foreground">Lihat semua warung mitra di peta</span>
              </span>
              {allIndonesia && <CheckIcon className="size-5 text-primary" />}
            </button>
          )}
          <button
            type="button"
            onClick={async () => {
              if (!(await request())) return;
              pickLocation();
              onOpenChange(false);
            }}
            disabled={isLocating}
            className={cn(
              "flex w-full items-center gap-3 rounded-2xl p-3 text-left ring-1 transition-colors",
              gpsActive ? "bg-brand-soft ring-primary/40" : "bg-card ring-border hover:bg-muted",
            )}
          >
            <span className="inline-flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              {isLocating ? <Loader2Icon className="size-5 animate-spin" /> : <LocateFixedIcon className="size-5" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">Gunakan lokasi saya</span>
              <span className="block text-xs text-muted-foreground">
                {isLocating ? "Mencari lokasi…" : "Paling akurat untuk radius 2 km"}
              </span>
            </span>
            {gpsActive && <CheckIcon className="size-5 text-primary" />}
          </button>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Radius</h3>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Radius pencarian">
              {RADIUS_OPTIONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={!allIndonesia && radius === r}
                  onClick={() => {
                    setRadius(r);
                    pickLocation();
                    // From the nationwide view this switches the map: show it.
                    if (allIndonesia) onOpenChange(false);
                  }}
                  className={cn(
                    "h-11 rounded-2xl text-sm font-semibold tabular-nums ring-1 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    !allIndonesia && radius === r
                      ? "bg-foreground text-background ring-foreground"
                      : "bg-card ring-border hover:bg-muted",
                  )}
                >
                  {formatRadius(r)}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {allIndonesia
                ? `Memilih radius menampilkan warung di sekitar ${label}.`
                : "Default 2 km supaya makanan masih hangat saat kamu ambil sendiri."}
            </p>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
              Pilih kampus / kota
            </h3>
            <CampusPicker
              value={source === "campus" && !allIndonesia ? campusId : null}
              onSelect={(id) => {
                setCampus(id);
                pickLocation();
                onOpenChange(false);
              }}
            />
          </section>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
