"use client";

import { useEffect, useState } from "react";

/** `value`, settled for `delayMs` (the publisher's AI quote is debounced 300 ms). */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return settled;
}
