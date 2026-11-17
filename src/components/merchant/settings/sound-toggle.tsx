"use client";

import { useSyncExternalStore } from "react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { isSoundEnabled, playAlert, setSoundEnabled, subscribeSound } from "../lib/alert-sound";

/**
 * Alert tone + vibration for new orders, cancel requests and chat (per device). Used in
 * Pengaturan and on the Pesanan page, so a cashier (who cannot open Pengaturan) can switch it too.
 * The server render assumes "on" (the default) and the stored choice applies after hydration.
 */
export function SoundToggle({ label, description, className }: { label: string; description?: string; className?: string }) {
  const on = useSyncExternalStore(subscribeSound, isSoundEnabled, () => true);
  return (
    <label className={cn("flex cursor-pointer items-center justify-between gap-3", className)}>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        {description && <span className="block text-xs text-muted-foreground">{description}</span>}
      </span>
      <Switch
        checked={on}
        onCheckedChange={(v) => {
          setSoundEnabled(v);
          if (v) playAlert("order");
        }}
        aria-label={label}
      />
    </label>
  );
}
