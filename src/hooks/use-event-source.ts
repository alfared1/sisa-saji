"use client";

/**
 * Server-Sent Events with auto-reconnect (exponential backoff 1 s → 30 s),
 * pause while the tab is hidden, and cleanup on unmount / url change.
 *
 *   useEventSource<BatchStreamEvent>(url, "batch", (ev) => ...)
 */
import { useEffect, useRef, useState } from "react";

export type EventSourceStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export type UseEventSourceOptions = {
  enabled?: boolean;
  /** Close the stream while the page is hidden (default true). */
  pauseWhenHidden?: boolean;
  withCredentials?: boolean;
};

const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

export function useEventSource<T>(
  url: string | null,
  eventName: string,
  onMessage: (data: T) => void,
  { enabled = true, pauseWhenHidden = true, withCredentials = true }: UseEventSourceOptions = {},
): { status: EventSourceStatus } {
  const [status, setStatus] = useState<EventSourceStatus>("idle");
  const handlerRef = useRef(onMessage);

  useEffect(() => {
    handlerRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!enabled || !url || typeof window === "undefined" || !("EventSource" in window)) {
      return;
    }

    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let backoff = MIN_BACKOFF_MS;
    let disposed = false;

    const listener = (ev: MessageEvent<string>) => {
      try {
        handlerRef.current(JSON.parse(ev.data) as T);
      } catch {
        /* malformed event — ignore */
      }
    };

    const close = () => {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      if (es) {
        es.removeEventListener(eventName, listener as EventListener);
        es.close();
        es = null;
      }
    };

    const connect = () => {
      if (disposed) return;
      close();
      setStatus((s) => (s === "open" || s === "reconnecting" ? "reconnecting" : "connecting"));
      es = new EventSource(url, { withCredentials });
      es.addEventListener(eventName, listener as EventListener);
      es.onopen = () => {
        backoff = MIN_BACKOFF_MS;
        setStatus("open");
      };
      es.onerror = () => {
        // Browsers auto-retry some failures; we take over for consistent backoff.
        close();
        if (disposed) return;
        setStatus("reconnecting");
        const jitter = Math.random() * 300;
        retryTimer = setTimeout(connect, backoff + jitter);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      };
    };

    const onVisibility = () => {
      if (!pauseWhenHidden) return;
      if (document.visibilityState === "hidden") {
        close();
        setStatus("closed");
      } else if (!es) {
        backoff = MIN_BACKOFF_MS;
        connect();
      }
    };

    connect();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      close();
      setStatus("closed");
    };
  }, [url, eventName, enabled, pauseWhenHidden, withCredentials]);

  return { status };
}
