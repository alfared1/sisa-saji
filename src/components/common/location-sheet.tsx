"use client";

import { CheckIcon, LocateFixedIcon, Loader2Icon } from "lucide-react";
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
import { CampusPicker } from "./campus-picker";

/** Bottom sheet: use GPS, choose the radius, or pick a campus / city quick-location. */
export function LocationSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { request, isLocating } = useGeolocation();
  const source = useLocationStore((s) => s.source);
  const campusId = useLocationStore((s) => s.campus_id);
  const radius = useLocationStore((s) => s.radius_m);
  const setCampus = useLocationStore((s) => s.setCampus);
  const setRadius = useLocationStore((s) => s.setRadius);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-w-md rounded-t-3xl">
        <DrawerHeader className="text-left">
          <DrawerTitle className="text-lg font-bold">Lokasi pencarian</DrawerTitle>
          <DrawerDescription>Kami tampilkan surplus makanan di sekitar titik ini.</DrawerDescription>
        </DrawerHeader>
        <div className="min-h-0 space-y-5 overflow-y-auto overscroll-contain px-4 pb-6">
          <button
            type="button"
            onClick={async () => {
              if (await request()) onOpenChange(false);
            }}
            disabled={isLocating}
            className={cn(
              "flex w-full items-center gap-3 rounded-2xl p-3 text-left ring-1 transition-colors",
              source === "gps" ? "bg-brand-soft ring-primary/40" : "bg-card ring-border hover:bg-muted",
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
            {source === "gps" && <CheckIcon className="size-5 text-primary" />}
          </button>

          <section>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Radius</h3>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Radius pencarian">
              {RADIUS_OPTIONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={radius === r}
                  onClick={() => setRadius(r)}
                  className={cn(
                    "h-11 rounded-2xl text-sm font-semibold tabular-nums ring-1 transition-colors",
                    radius === r ? "bg-foreground text-background ring-foreground" : "bg-card ring-border hover:bg-muted",
                  )}
                >
                  {formatRadius(r)}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Default 2 km supaya makanan masih hangat saat kamu ambil sendiri.
            </p>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Pilih kampus / kota
            </h3>
            <CampusPicker
              value={source === "campus" ? campusId : null}
              onSelect={(id) => {
                setCampus(id);
                onOpenChange(false);
              }}
            />
          </section>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
