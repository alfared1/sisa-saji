"use client";

import { useSyncExternalStore } from "react";
import {
  getInstallPromptServerSnapshot,
  getInstallPromptSnapshot,
  subscribeInstallPrompt,
  triggerInstallPrompt,
} from "@/lib/pwa/install-prompt";

type Env = { isStandalone: boolean; isIOS: boolean };
const serverEnv: Env = { isStandalone: false, isIOS: false };
let clientEnv: Env | null = null;

function readEnv(): Env {
  if (clientEnv) return clientEnv;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  clientEnv = {
    isStandalone: window.matchMedia?.("(display-mode: standalone)").matches || nav.standalone === true,
    isIOS: /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1),
  };
  return clientEnv;
}

const noopSubscribe = () => () => {};

/** `beforeinstallprompt` wrapper + iOS / standalone detection. */
export function useInstallPrompt() {
  const snap = useSyncExternalStore(
    subscribeInstallPrompt,
    getInstallPromptSnapshot,
    getInstallPromptServerSnapshot,
  );
  const env = useSyncExternalStore(noopSubscribe, readEnv, () => serverEnv);

  return {
    /** Chrome/Edge/Android: a native prompt can be shown. */
    canInstall: snap.event !== null && !env.isStandalone,
    /** iOS Safari needs manual "Bagikan → Tambahkan ke Layar Utama". */
    showIOSHint: env.isIOS && !env.isStandalone,
    isStandalone: env.isStandalone || snap.installed,
    isIOS: env.isIOS,
    promptInstall: triggerInstallPrompt,
  };
}
