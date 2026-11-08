"use client";

/**
 * PWAInstallPromptBanner: native prompt on Chrome/Edge/Android, manual
 * "Bagikan → Tambahkan ke Layar Utama" hint on iOS. Hidden when installed or
 * dismissed (remembered per device).
 */
import { useState, useSyncExternalStore } from "react";
import { DownloadIcon, ShareIcon, XIcon } from "lucide-react";
import { LogoMark } from "@/components/common/logo";
import { Button } from "@/components/ui/button";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import { readLocal, writeLocal } from "@/lib/pwa/storage";
import { cn } from "@/lib/utils";

const DISMISS_KEY = "ss-install-dismissed";
const noopSubscribe = () => () => {};

export function InstallBanner({
  className,
  /** Show a static preview even when the browser offers no prompt (gallery). */
  forceVisible = false,
}: {
  className?: string;
  forceVisible?: boolean;
}) {
  const { canInstall, showIOSHint, isStandalone, promptInstall } = useInstallPrompt();
  const storedDismissed = useSyncExternalStore(
    noopSubscribe,
    () => readLocal(DISMISS_KEY) === "1",
    () => true,
  );
  const [dismissed, setDismissed] = useState(false);

  const visible = forceVisible || (!isStandalone && !storedDismissed && !dismissed && (canInstall || showIOSHint));
  if (!visible) return null;

  const dismiss = () => {
    writeLocal(DISMISS_KEY, "1");
    setDismissed(true);
  };

  return (
    <aside
      aria-label="Pasang aplikasi"
      className={cn(
        "animate-float-up relative flex items-center gap-3 rounded-3xl bg-card p-3 pr-10 shadow-card ring-1 ring-border",
        className,
      )}
    >
      <LogoMark className="size-12 rounded-2xl" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">Pasang Sisa-Saji</p>
        {showIOSHint && !canInstall ? (
          <p className="text-xs leading-snug text-muted-foreground">
            Ketuk <ShareIcon className="inline size-3.5 align-[-2px]" aria-label="Bagikan" /> lalu{" "}
            <b className="text-foreground">Tambahkan ke Layar Utama</b>.
          </p>
        ) : (
          <p className="text-xs leading-snug text-muted-foreground">
            Buka lebih cepat & tiket tetap bisa dibuka saat sinyal lemah.
          </p>
        )}
      </div>
      {(canInstall || forceVisible) && !(showIOSHint && !canInstall) && (
        <Button size="sm" className="h-9 rounded-full px-3.5" onClick={() => void promptInstall()}>
          <DownloadIcon /> Pasang
        </Button>
      )}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Tutup"
        className="absolute top-2 right-2 inline-flex size-7 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <XIcon className="size-4" />
      </button>
    </aside>
  );
}
