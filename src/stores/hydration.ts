/**
 * Persisted stores use `skipHydration` so server HTML and the first client
 * render agree. <StoreHydration /> (in Providers) rehydrates them after mount;
 * `useStoresHydrated()` tells components when persisted values are available.
 */
import { useSyncExternalStore } from "react";
import { useCartStore } from "./cart";
import { useLocationStore } from "./location";
import { useTicketsStore } from "./tickets";

const persisted = [useCartStore, useLocationStore, useTicketsStore] as const;

let hydrated = false;
let started = false;
const listeners = new Set<() => void>();

export async function rehydratePersistedStores(): Promise<void> {
  if (started) return;
  started = true;
  await Promise.all(
    persisted.map(async (store) => {
      try {
        await store.persist?.rehydrate();
      } catch {
        /* corrupted storage: keep defaults */
      }
    }),
  );
  hydrated = true;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useStoresHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => hydrated,
    () => false,
  );
}
