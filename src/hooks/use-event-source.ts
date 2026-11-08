"use client";

/**
 * Server-Sent Events with auto-reconnect (exponential backoff 1 s → 30 s),
 * pause while the tab is hidden, and cleanup on unmount / url change.
 *
 *   useEventSource<BatchStreamEvent>(url, "batch", (ev) => ..., { onReconnect })
 *
 * We open a fresh EventSource on every reconnect (for consistent backoff), and
 * a fresh object never sends the Last-Event-ID header. So the last seen id is
 * forwarded as `?last_event_id=` instead, and `onReconnect` fires when a stream
 * re-opens after a drop so callers can refetch whatever the gap may have hidden.
 */
import { useEffect, useRef, useState } from "react";

export type EventSourceStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export type UseEventSourceOptions = {
  enabled?: boolean;
  /** Close the stream while the page is hidden (default true). */
  pauseWhenHidden?: boolean;
  withCredentials?: boolean;
  /** Called when the stream opens again after an error / hidden-tab pause. */
  onReconnect?: () => void;
};

export const LAST_EVENT_ID_PARAM = "last_event_id";

/** `url` with `last_event_id=<id>` set (or unchanged when there is no id yet). */
export function withLastEventId(url: string, lastEventId: string | null): string {
  if (!lastEventId) return url;
  const hashAt = url.indexOf("#");
  const base = hashAt === -1 ? url : url.slice(0, hashAt);
  const [path, query = ""] = base.split("?", 2) as [string, string?];
  const params = new URLSearchParams(query);
  params.set(LAST_EVENT_ID_PARAM, lastEventId);
  return `${path}?${params.toString()}`;
}

const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

export function useEventSource<T>(
  url: string | null,
  eventName: string,
  onMessage: (data: T) => void,
  { enabled = true, pauseWhenHidden = true, withCredentials = true, onReconnect }: UseEventSourceOptions = {},
): { status: EventSourceStatus } {
  const [status, setStatus] = useState<EventSourceStatus>("idle");
  const handlerRef = useRef(onMessage);
  const reconnectRef = useRef(onReconnect);

  useEffect(() => {
    handlerRef.current = onMessage;
    reconnectRef.current = onReconnect;
  }, [onMessage, onReconnect]);

  useEffect(() => {
    if (!enabled || !url || typeof window === "undefined" || !("EventSource" in window)) {
      return;
    }

    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let backoff = MIN_BACKOFF_MS;
    let disposed = false;
    let lastEventId: string | null = null;
    // Set once a connection has dropped; the next successful open is a "reconnect".
    let dropped = false;

    const listener = (ev: MessageEvent<string>) => {
      if (ev.lastEventId) lastEventId = ev.lastEventId;
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
      es = new EventSource(withLastEventId(url, lastEventId), { withCredentials });
      es.addEventListener(eventName, listener as EventListener);
      es.onopen = () => {
        backoff = MIN_BACKOFF_MS;
        setStatus("open");
        if (dropped) {
          dropped = false;
          reconnectRef.current?.();
        }
      };
      es.onerror = () => {
        // Browsers auto-retry some failures; we take over for consistent backoff.
        dropped = true;
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
        if (es) dropped = true;
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
