"use client";

/**
 * HTML5QRScannerViewport — html5-qrcode with the back camera. The library is
 * imported on demand (client-only); the camera starts on tap, or automatically
 * when permission was granted before. Denied / missing camera → clear fallback.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CameraIcon, CameraOffIcon, Loader2Icon, ScanLineIcon, SquareIcon } from "lucide-react";
import type { Html5Qrcode } from "html5-qrcode";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ScannerState = "idle" | "starting" | "scanning" | "denied" | "unavailable";

function classifyError(err: unknown): ScannerState {
  const name = typeof err === "object" && err !== null && "name" in err ? String((err as { name: unknown }).name) : "";
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (/NotAllowed|Permission|denied/i.test(name + msg)) return "denied";
  return "unavailable";
}

export function QrScanner({ paused, onDecode, className }: { paused: boolean; onDecode: (text: string) => void; className?: string }) {
  const rawId = useId();
  const elementId = `qr-${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const onDecodeRef = useRef(onDecode);
  const lastRef = useRef<{ text: string; at: number } | null>(null);
  const [state, setState] = useState<ScannerState>("idle");

  useEffect(() => {
    onDecodeRef.current = onDecode;
  }, [onDecode]);

  const stop = useCallback(async () => {
    const s = scannerRef.current;
    scannerRef.current = null;
    if (s) {
      try {
        if (s.isScanning) await s.stop();
        s.clear();
      } catch {
        /* already stopped */
      }
    }
  }, []);

  const start = useCallback(async () => {
    if (scannerRef.current) return;
    setState("starting");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("unsupported");
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");
      const scanner = new Html5Qrcode(elementId, { formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE], verbose: false });
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: (w, h) => { const s = Math.floor(Math.min(w, h) * 0.7); return { width: s, height: s }; }, aspectRatio: 1 },
        (text) => {
          const now = Date.now();
          const last = lastRef.current;
          if (last && last.text === text && now - last.at < 4000) return; // same ticket held in front of the lens
          lastRef.current = { text, at: now };
          onDecodeRef.current(text);
        },
        () => undefined,
      );
      setState("scanning");
    } catch (err) {
      await stop();
      setState(classifyError(err));
    }
  }, [elementId, stop]);

  // Auto-start only when the camera permission is already granted (no surprise prompt).
  useEffect(() => {
    let cancelled = false;
    const perms = navigator.permissions as Permissions | undefined;
    perms
      ?.query({ name: "camera" as PermissionName })
      .then((p) => {
        if (!cancelled && p.state === "granted") void start();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      void stop();
    };
  }, [start, stop]);

  // Pause decoding while a ticket is being verified.
  useEffect(() => {
    const s = scannerRef.current;
    if (!s || state !== "scanning") return;
    try {
      if (paused) s.pause(true);
      else s.resume();
    } catch {
      /* not in a pausable state */
    }
  }, [paused, state]);

  const active = state === "scanning" || state === "starting";

  return (
    <div className={cn("overflow-hidden rounded-3xl bg-neutral-950 text-white shadow-card", className)}>
      <div className="relative aspect-square w-full sm:aspect-[4/3] lg:aspect-[16/9]">
        <div id={elementId} className={cn("absolute inset-0 [&_video]:h-full! [&_video]:w-full! [&_video]:object-cover", !active && "invisible")} />

        {state === "scanning" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
            <div className="relative size-[70%] rounded-3xl ring-2 ring-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]">
              <span className="absolute inset-x-6 top-1/2 h-0.5 animate-soft-pulse rounded-full bg-emerald-400 shadow-[0_0_12px_2px_rgba(52,211,153,0.7)]" />
            </div>
          </div>
        )}

        {!active && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            {state === "idle" && (
              <>
                <span className="inline-flex size-16 items-center justify-center rounded-3xl bg-white/10 ring-1 ring-white/15">
                  <ScanLineIcon className="size-8" />
                </span>
                <p className="text-base font-semibold">Pindai QR tiket pembeli</p>
                <p className="max-w-64 text-sm text-white/70">Arahkan kamera belakang ke QR di layar HP pembeli.</p>
                <Button onClick={() => void start()} className="mt-1 h-12 rounded-xl bg-white px-6 text-sm font-semibold text-neutral-950 hover:bg-white/90">
                  <CameraIcon /> Nyalakan kamera
                </Button>
              </>
            )}
            {(state === "denied" || state === "unavailable") && (
              <>
                <span className="inline-flex size-16 items-center justify-center rounded-3xl bg-white/10 ring-1 ring-white/15">
                  <CameraOffIcon className="size-8" />
                </span>
                <p className="text-base font-semibold" role="alert">
                  {state === "denied" ? "Akses kamera ditolak" : "Kamera tidak tersedia"}
                </p>
                <p className="max-w-72 text-sm text-white/70">
                  {state === "denied"
                    ? "Izinkan kamera lewat ikon gembok di bilah alamat, atau ketik 4 digit kode SJ- di bawah."
                    : "Perangkat ini tidak punya kamera yang bisa dipakai. Ketik 4 digit kode SJ- di bawah."}
                </p>
                <Button onClick={() => void start()} variant="outline" className="mt-1 h-11 rounded-xl border-white/30 bg-transparent px-5 text-white hover:bg-white/10 hover:text-white">
                  Coba lagi
                </Button>
              </>
            )}
          </div>
        )}

        {state === "starting" && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm font-semibold" role="status">
            <Loader2Icon className="size-5 animate-spin" /> Menyalakan kamera…
          </div>
        )}

        {state === "scanning" && (
          <button
            type="button"
            onClick={() => void stop().then(() => setState("idle"))}
            className="absolute right-3 bottom-3 inline-flex h-10 items-center gap-1.5 rounded-full bg-black/60 px-3.5 text-xs font-semibold backdrop-blur outline-none focus-visible:ring-3 focus-visible:ring-white/60"
          >
            <SquareIcon className="size-3.5 fill-current" /> Matikan kamera
          </button>
        )}
        {state === "scanning" && paused && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-sm font-semibold">Memeriksa tiket…</div>
        )}
      </div>
    </div>
  );
}
