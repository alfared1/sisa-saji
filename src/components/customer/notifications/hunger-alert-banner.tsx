"use client";

/**
 * "Notifikasi Jam Lapar": the opt-in banner on /discover and the status row on Akun and
 * Dampak. The banner shows only when push works in this browser, the server says the alert
 * is off for this device, and the buyer has not tapped "Nanti saja".
 */
import { useState } from "react";
import { BellRingIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useHungerAlert } from "@/hooks/use-hunger-alert";
import { cn } from "@/lib/utils";
import { HUNGER_ALERT_TIME_LABEL, HungerAlertDialog } from "./hunger-alert-dialog";

export function HungerAlertBanner(): React.ReactNode {
  const alert = useHungerAlert();
  const [open, setOpen] = useState(false);
  const visible = alert.supported && alert.ready && !alert.enabled && !alert.dismissed && alert.permission !== "denied";

  return (
    <>
      {visible && (
        <section aria-labelledby="hunger-banner-title" className="rounded-2xl bg-card p-4 shadow-soft ring-1 ring-border">
          <div className="flex items-start gap-3">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-primary">
              <BellRingIcon className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="hunger-banner-title" className="text-sm font-semibold">
                Aktifkan Notifikasi Jam Lapar ({HUNGER_ALERT_TIME_LABEL})
              </h2>
              <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                Sekali semalam, kami kabari saat warung dalam {alert.radiusM} m dari kosmu buka diskon malam.
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" className="h-10 rounded-xl px-4 font-semibold" onClick={alert.dismiss}>
              Nanti saja
            </Button>
            <Button type="button" className="h-10 rounded-xl px-4 font-semibold" onClick={() => setOpen(true)}>
              Aktifkan
            </Button>
          </div>
        </section>
      )}
      <HungerAlertDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

/** Akun and Dampak: "Notifikasi Jam Lapar aktif" with "Matikan", or a way back in after "Nanti saja". */
export function HungerAlertStatus({ className }: { className?: string }): React.ReactNode {
  const alert = useHungerAlert();
  const [open, setOpen] = useState(false);
  if (!alert.supported || !alert.ready) return null;
  const on = alert.enabled;

  return (
    <>
      <div className={cn("flex items-center gap-3 rounded-3xl bg-card p-4 shadow-soft ring-1 ring-border", className)}>
        <span
          className={cn(
            "inline-flex size-11 shrink-0 items-center justify-center rounded-2xl",
            on ? "bg-brand-soft text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          <BellRingIcon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{on ? "Notifikasi Jam Lapar aktif" : "Notifikasi Jam Lapar"}</p>
          <p className="text-xs leading-snug text-muted-foreground">
            {on
              ? `Sekali semalam mulai ${HUNGER_ALERT_TIME_LABEL}, untuk warung dalam ${alert.radiusM} m dari ${alert.label ?? "titikmu"}.`
              : `Kabari aku sekali semalam saat warung dalam ${alert.radiusM} m dari kos buka diskon malam.`}
          </p>
          {/* The dialog keeps "Kirim contoh notifikasi" reachable after the alert is switched on. */}
          {on && (
            <Button type="button" variant="link" className="h-8 px-0 text-xs font-semibold" onClick={() => setOpen(true)}>
              Atur atau kirim contoh
            </Button>
          )}
        </div>
        {on ? (
          <Button
            type="button"
            variant="outline"
            className="h-10 shrink-0 rounded-xl px-3 font-semibold"
            onClick={() => alert.disable.mutate()}
            disabled={alert.disable.isPending}
          >
            {alert.disable.isPending ? <Loader2Icon className="animate-spin" aria-label="Mematikan" /> : "Matikan"}
          </Button>
        ) : (
          <Button
            type="button"
            className="h-10 shrink-0 rounded-xl px-3 font-semibold"
            onClick={() => setOpen(true)}
            disabled={alert.permission === "denied"}
          >
            Atur
          </Button>
        )}
      </div>
      <HungerAlertDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
