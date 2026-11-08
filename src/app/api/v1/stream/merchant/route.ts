import { connection } from "next/server";
import { getDb } from "@/db";
import { handle } from "@/server/http";
import { requireMerchant } from "@/server/auth/session";
import { pollMerchantEvents } from "@/server/services/merchant/stream";

const POLL_MS = 5_000;
const PING_MS = 20_000;
/** Re-read this much before the cursor each poll (late commits); duplicates are filtered by key. */
const OVERLAP_MS = 3_000;
/** Accept a resume cursor only up to this old (Last-Event-ID). */
const MAX_RESUME_MS = 60 * 60_000;

function resumeCursor(v: string | null, now: number): number | null {
  if (!v || v.length > 40 || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v)) return null;
  const t = Date.parse(v);
  if (Number.isNaN(t) || t > now || now - t > MAX_RESUME_MS) return null;
  return t;
}

/**
 * GET /api/v1/stream/merchant — merchant Server-Sent Events.
 * `event: merchant` with MerchantStreamEvent data (order.paid, order.completed,
 * batch.updated); `: ping` every 20 s. The `id:` of each event is an ISO cursor,
 * so EventSource resumes via Last-Event-ID after a reconnect.
 */
export const GET = handle(async (req) => {
  await connection();
  const { merchantId } = await requireMerchant();
  const db = getDb();
  let cursor = resumeCursor(req.headers.get("last-event-id"), Date.now()) ?? Date.now();
  const seen = new Map<string, number>(); // event key → event time (pruned past the overlap window)

  const encoder = new TextEncoder();
  let closed = false;
  let polling = false;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(pollTimer);
        clearInterval(pingTimer);
        req.signal.removeEventListener("abort", cleanup);
        try {
          controller.close();
        } catch {
          // already closed by the runtime
        }
      };
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };

      const poll = async () => {
        if (closed || polling) return;
        polling = true;
        const startedAt = Date.now();
        try {
          const events = await pollMerchantEvents(db, merchantId, new Date(cursor - OVERLAP_MS));
          const id = new Date(startedAt).toISOString();
          for (const e of events) {
            if (seen.has(e.key)) continue;
            seen.set(e.key, e.at);
            write(`event: merchant\nid: ${id}\ndata: ${JSON.stringify(e.event)}\n\n`);
          }
          cursor = Math.max(cursor, startedAt);
          for (const [k, at] of seen) if (at < cursor - 2 * OVERLAP_MS) seen.delete(k);
        } catch (err) {
          console.warn("[sse] stream/merchant poll failed", err instanceof Error ? err.message : err);
        } finally {
          polling = false;
        }
      };

      write(`retry: ${POLL_MS}\n: connected\n\n`);
      pollTimer = setInterval(poll, POLL_MS);
      pingTimer = setInterval(() => write(": ping\n\n"), PING_MS);
      if (req.signal.aborted) cleanup();
      else req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      closed = true;
      clearInterval(pollTimer);
      clearInterval(pingTimer);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
});
