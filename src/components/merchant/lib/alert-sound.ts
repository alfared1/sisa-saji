"use client";

/**
 * Short alert tones for the warung while the app is open (new paid order, a buyer asking to
 * cancel, a chat message), plus a vibration on phones. Tones are synthesised with Web Audio,
 * so there is no sound file to load. Browsers only allow audio after the page was touched once,
 * so the context is resumed on the first tap; until then the alert just vibrates.
 * The warung can turn sounds off in Pengaturan (stored per device).
 */

const STORAGE_KEY = "ss-merchant-sound";
type AlertKind = "order" | "attention" | "message";

/** Frequencies (Hz) per kind: a rising pair for orders, three notes for attention, one soft ping. */
const PATTERNS: Record<AlertKind, { freq: number[]; vibrate: number[] }> = {
  order: { freq: [880, 1320], vibrate: [120, 60, 120] },
  attention: { freq: [988, 784, 988], vibrate: [200, 80, 200, 80, 200] },
  message: { freq: [1046], vibrate: [80] },
};

let ctx: AudioContext | null = null;
let unlockInstalled = false;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  return ctx;
}

/** Resume audio on the first tap anywhere (autoplay rules). Safe to call often. */
export function installSoundUnlock(): void {
  if (unlockInstalled || typeof window === "undefined") return;
  unlockInstalled = true;
  const unlock = () => {
    void audioContext()?.resume().catch(() => undefined);
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

export function isSoundEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    /* storage blocked: the default (on) stays */
  }
}

export function playAlert(kind: AlertKind): void {
  if (typeof window === "undefined" || !isSoundEnabled()) return;
  const pattern = PATTERNS[kind];
  try {
    navigator.vibrate?.(pattern.vibrate);
  } catch {
    /* vibration unsupported */
  }
  const ac = audioContext();
  if (!ac || ac.state !== "running") return;
  const start = ac.currentTime + 0.02;
  pattern.freq.forEach((f, i) => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.value = f;
    const t = start + i * 0.18;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.17);
  });
}
