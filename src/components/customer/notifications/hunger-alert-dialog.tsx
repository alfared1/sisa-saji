"use client";

/**
 * Settings for "Notifikasi Jam Lapar": where the point is, a WhatsApp-style text that is
 * only a labelled simulation (nothing is ever sent over WhatsApp), and the real browser
 * push: enable, send a sample to this device, turn off.
 */
import { BellRingIcon, Loader2Icon, LocateFixedIcon, MapPinIcon, MessageSquareTextIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useGeolocation } from "@/hooks/use-geolocation";
import { useHungerAlert } from "@/hooks/use-hunger-alert";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import { HUNGER_ALERT_HOUR } from "@/lib/constants";
import { useLocationStore } from "@/stores/location";

export const HUNGER_ALERT_TIME_LABEL = `${HUNGER_ALERT_HOUR.replace(":", ".")} WIB`;

/** The simulated WhatsApp text: same shape as the real push, with an example warung. */
function simulatedText(label: string): string {
  return `Jam lapar: Warung Nasi Teh Euis buka diskon malam. Nasi Timbel + Lauk Pilihan Rp 10.000 (hemat 44%), sisa 4 porsi, 350 m dari ${label}. Tutup 22.30.`;
}

export function HungerAlertDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const alert = useHungerAlert();
  const geo = useGeolocation();
  const { showIOSHint } = useInstallPrompt();
  const lat = useLocationStore((s) => s.lat);
  const lng = useLocationStore((s) => s.lng);
  const currentLabel = useLocationStore((s) => s.label);
  const source = useLocationStore((s) => s.source);

  // Once on, the point is the one the server stored; before that, the one we would send.
  const label = alert.enabled ? (alert.label ?? currentLabel) : currentLabel;
  const isCampus = !alert.enabled && source === "campus";
  const busy = alert.enable.isPending || alert.disable.isPending;
  const denied = alert.permission === "denied";

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-[calc(100%-2rem)] overflow-y-auto rounded-3xl p-5 sm:max-w-md sm:p-6">
        <DialogHeader className="text-left sm:text-left">
          <span className="mb-1 inline-flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-primary">
            <BellRingIcon className="size-6" aria-hidden />
          </span>
          <DialogTitle className="text-lg font-bold">Notifikasi Jam Lapar</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            Sekali semalam mulai pukul {HUNGER_ALERT_TIME_LABEL}, kami kabari saat warung dalam {alert.radiusM} m dari titikmu buka
            diskon malam.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-2xl bg-surface p-3">
            <p className="flex items-start gap-2 text-sm">
              <MapPinIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0">
                Titik notifikasi: <span className="font-semibold break-words">{label}</span>
              </span>
            </p>
            {alert.enabled && <p className="mt-1 pl-6 text-xs text-muted-foreground">Notifikasi Jam Lapar aktif untuk titik ini.</p>}
            {isCampus && (
              <div className="mt-3 rounded-xl bg-warning-soft p-3 text-xs leading-relaxed text-amber-900 dark:text-amber-100">
                <p className="flex items-start gap-2 font-semibold">
                  <TriangleAlertIcon className="mt-px size-4 shrink-0" aria-hidden />
                  Ini titik kampus, bukan kosmu.
                </p>
                <p className="mt-1 pl-6">Biar jaraknya pas, nyalakan dari kos dan pakai lokasimu sekarang.</p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-2 ml-6 h-10 rounded-xl bg-card font-semibold"
                  onClick={() => void geo.request()}
                  disabled={geo.isLocating}
                >
                  {geo.isLocating ? <Loader2Icon className="animate-spin" aria-hidden /> : <LocateFixedIcon aria-hidden />}
                  Pakai lokasi sekarang
                </Button>
              </div>
            )}
          </div>

          {showIOSHint && !alert.enabled && (
            <p className="rounded-2xl bg-surface p-3 text-xs leading-relaxed text-muted-foreground">
              Di iPhone, pasang aplikasinya ke layar utama dulu. Notifikasi baru bisa dinyalakan dari aplikasi yang terpasang.
            </p>
          )}

          <section aria-labelledby="hunger-simulasi" className="rounded-2xl p-3 ring-1 ring-border">
            <div className="flex items-center justify-between gap-2">
              <p id="hunger-simulasi" className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <MessageSquareTextIcon className="size-4 shrink-0" aria-hidden />
                Pratinjau pesan WhatsApp
              </p>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">Simulasi</span>
            </div>
            <p className="mt-2 rounded-xl bg-brand-soft px-3 py-2 text-sm leading-snug text-foreground">{simulatedText(label)}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Simulasi, tidak dikirim lewat WhatsApp. Notifikasi sungguhan datang dari browser di perangkat ini.
            </p>
          </section>

          {denied && !alert.enabled && (
            <p className="text-xs leading-relaxed text-urgent">Notifikasi diblokir. Izinkan lewat pengaturan browser, lalu coba lagi.</p>
          )}

          <div className="flex flex-col gap-2 pt-1">
            {alert.enabled ? (
              <>
                <Button
                  type="button"
                  className="h-11 rounded-xl font-semibold"
                  onClick={() => alert.sendTest.mutate()}
                  disabled={alert.sendTest.isPending}
                >
                  {alert.sendTest.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
                  Kirim contoh notifikasi
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 rounded-xl font-semibold"
                  onClick={() => alert.disable.mutate()}
                  disabled={busy}
                >
                  {alert.disable.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
                  Matikan
                </Button>
              </>
            ) : (
              <Button
                type="button"
                className="h-11 rounded-xl font-semibold"
                onClick={() => alert.enable.mutate({ lat, lng, label: currentLabel })}
                disabled={busy || denied || !alert.supported}
              >
                {alert.enable.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
                Aktifkan notifikasi
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
