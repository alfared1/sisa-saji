"use client";

/**
 * Registers /sw.js (production, or NEXT_PUBLIC_ENABLE_SW=true) and runs the
 * update flow: when a new SW is waiting, offer "Muat ulang" → SKIP_WAITING →
 * reload once the new worker takes control.
 */
import { useEffect } from "react";
import { toast } from "sonner";
import { isServiceWorkerAutoEnabled, isServiceWorkerSupported, registerServiceWorker } from "@/lib/pwa/sw";

function promptUpdate(worker: ServiceWorker) {
  toast("Versi baru Sisa-Saji tersedia", {
    id: "sw-update",
    description: "Muat ulang untuk memakai versi terbaru.",
    duration: Infinity,
    action: {
      label: "Muat ulang",
      onClick: () => worker.postMessage({ type: "SKIP_WAITING" }),
    },
  });
}

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!isServiceWorkerSupported() || !isServiceWorkerAutoEnabled()) return;
    let cancelled = false;
    let reloading = false;
    const hadController = Boolean(navigator.serviceWorker.controller);

    const onControllerChange = () => {
      // Only reload for updates, not for the very first install.
      if (!hadController || reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    void registerServiceWorker().then((reg) => {
      if (!reg || cancelled) return;
      if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            promptUpdate(installing);
          }
        });
      });
      // Check for updates when the app regains focus (long-lived PWA sessions).
      const onVisible = () => {
        if (document.visibilityState === "visible") void reg.update().catch(() => undefined);
      };
      document.addEventListener("visibilitychange", onVisible);
    });

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  return null;
}
