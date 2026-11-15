"use client";

import { useSyncExternalStore } from "react";

function subscribe(cb: () => void) {
  window.addEventListener("popstate", cb);
  return () => window.removeEventListener("popstate", cb);
}

/**
 * One query-string value of the current URL (null on the server and during hydration).
 * For deep links such as a push notification's `?chat=1`, without useSearchParams (which would
 * opt the whole page out of prerendering).
 */
export function useSearchParam(name: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => new URLSearchParams(window.location.search).get(name),
    () => null,
  );
}
