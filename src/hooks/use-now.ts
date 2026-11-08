"use client";

/**
 * Shared wall clock. One interval per tick size for the whole app, so fifty
 * countdown badges do not create fifty timers. Returns `null` on the server and
 * during hydration (Cache Components: no Date.now() in the prerendered shell).
 */
import { useSyncExternalStore } from "react";

type Clock = { now: number; listeners: Set<() => void>; timer: ReturnType<typeof setInterval> | null };
const clocks = new Map<number, Clock>();

function getClock(intervalMs: number): Clock {
  let c = clocks.get(intervalMs);
  if (!c) {
    c = { now: Date.now(), listeners: new Set(), timer: null };
    clocks.set(intervalMs, c);
  }
  return c;
}

function subscribe(intervalMs: number, listener: () => void): () => void {
  const c = getClock(intervalMs);
  c.listeners.add(listener);
  if (!c.timer) {
    c.now = Date.now();
    c.timer = setInterval(() => {
      c.now = Date.now();
      c.listeners.forEach((l) => l());
    }, intervalMs);
  }
  return () => {
    c.listeners.delete(listener);
    if (c.listeners.size === 0 && c.timer) {
      clearInterval(c.timer);
      c.timer = null;
    }
  };
}

/**
 * Stable subscribe/getSnapshot per interval. A fresh subscribe function on each
 * render would make React resubscribe every render; for the only subscriber of
 * an interval that restarts the timer and bumps `now` → infinite render loop.
 */
const bindings = new Map<number, { subscribe: (l: () => void) => () => void; getSnapshot: () => number }>();

function getBinding(intervalMs: number) {
  let b = bindings.get(intervalMs);
  if (!b) {
    b = {
      subscribe: (l) => subscribe(intervalMs, l),
      getSnapshot: () => getClock(intervalMs).now,
    };
    bindings.set(intervalMs, b);
  }
  return b;
}

const getServerSnapshot = () => null;

export function useNow(intervalMs = 1000): number | null {
  const b = getBinding(intervalMs);
  return useSyncExternalStore(b.subscribe, b.getSnapshot, getServerSnapshot);
}
