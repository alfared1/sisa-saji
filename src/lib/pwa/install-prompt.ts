/**
 * Captures `beforeinstallprompt` as early as possible (Providers call
 * `initInstallPromptCapture()` on mount) so any page can offer "Pasang
 * aplikasi" later through `useInstallPrompt()`.
 */
export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

export type InstallPromptSnapshot = { event: BeforeInstallPromptEvent | null; installed: boolean };

let snapshot: InstallPromptSnapshot = { event: null, installed: false };
const serverSnapshot: InstallPromptSnapshot = { event: null, installed: false };
const listeners = new Set<() => void>();
let initialised = false;

function emit(next: InstallPromptSnapshot) {
  snapshot = next;
  listeners.forEach((l) => l());
}

export function initInstallPromptCapture(): void {
  if (initialised || typeof window === "undefined") return;
  initialised = true;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    emit({ ...snapshot, event: e as BeforeInstallPromptEvent });
  });
  window.addEventListener("appinstalled", () => emit({ event: null, installed: true }));
}

export function subscribeInstallPrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getInstallPromptSnapshot(): InstallPromptSnapshot {
  return snapshot;
}

export function getInstallPromptServerSnapshot(): InstallPromptSnapshot {
  return serverSnapshot;
}

export async function triggerInstallPrompt(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const ev = snapshot.event;
  if (!ev) return "unavailable";
  await ev.prompt();
  const choice = await ev.userChoice;
  emit({ event: null, installed: choice.outcome === "accepted" });
  return choice.outcome;
}
