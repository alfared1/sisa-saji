/**
 * Browser storage helpers that never throw (private mode, blocked storage, SSR).
 */
import { createJSONStorage, type StateStorage } from "zustand/middleware";

const memory = new Map<string, string>();

/** localStorage when available, otherwise an in-memory fallback. */
export const safeLocalStorage: StateStorage<void> = {
  getItem: (name) => {
    try {
      return window.localStorage.getItem(name);
    } catch {
      return memory.get(name) ?? null;
    }
  },
  setItem: (name, value) => {
    try {
      window.localStorage.setItem(name, value);
    } catch {
      memory.set(name, value);
    }
  },
  removeItem: (name) => {
    try {
      window.localStorage.removeItem(name);
    } catch {
      memory.delete(name);
    }
  },
};

/** JSON storage for zustand `persist` (always paired with `skipHydration: true`). */
export function persistStorage<S>() {
  return createJSONStorage<S>(() => safeLocalStorage);
}

export function readLocal(key: string): string | null {
  if (typeof window === "undefined") return null;
  const v = safeLocalStorage.getItem(key);
  return typeof v === "string" ? v : null;
}

export function writeLocal(key: string, value: string): void {
  if (typeof window === "undefined") return;
  safeLocalStorage.setItem(key, value);
}

export function readSession<T>(key: string): T | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeSession(key: string, value: unknown): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function removeSession(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
