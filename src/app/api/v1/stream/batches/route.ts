import { connection } from "next/server";
import { getDb } from "@/db";
import { DiscoverQuery } from "@/lib/contracts";
import { fail } from "@/server/http";
import {
  type BatchStreamState,
  currentCursor,
  newBatchStreamState,
  pollBatchStream,
} from "@/server/services/discovery/discovery";

const POLL_MS = 5_000;
const PING_MS = 20_000;
const StreamQuery = DiscoverQuery.pick({ lat: true, lng: true, radius_m: true });

/** A Last-Event-ID we issued is a Postgres timestamptz text; accept only that shape. */
function validCursor(v: string | null): string | null {
  if (!v || v.length > 40 || !/^\d{4}-\d{2}-\d{2}[ T][\d:.]+([+-]\d{2}(:?\d{2})?|Z)?$/.test(v)) return null;
  return Number.isNaN(Date.parse(v.replace(" ", "T"))) ? null : v;
}

/**
 * GET /api/v1/stream/batches?lat&lng&radius_m — public Server-Sent Events.
 * Emits `event: batch` (BatchStreamEvent) for batches changed in the area; `: ping` every 20 s.
 */
export async function GET(req: Request) {
  await connection(); // request-time only, never prerendered
  const parsed = StreamQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams.entries()));
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      "Parameter tidak valid",
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  const area = parsed.data;
  const db = getDb();
  let state: BatchStreamState;
  try {
    state = newBatchStreamState(validCursor(req.headers.get("last-event-id")) ?? (await currentCursor(db)));
  } catch (err) {
    console.error("[sse] stream/batches: database unavailable", err);
    return fail("DB_UNAVAILABLE", "Database tidak dapat dihubungi");
  }

  const encoder = new TextEncoder();
  let closed = false;
  let polling = false;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
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

      const poll = async () => {
        if (closed || polling) return;
        polling = true;
        try {
          // Overlap window + dedupe: rows that commit late or share a stamp are not lost.
          const changes = await pollBatchStream(db, area, state);
          for (const ev of changes.events) {
            write(`event: batch\nid: ${changes.cursor}\ndata: ${JSON.stringify(ev)}\n\n`);
          }
        } catch (err) {
          console.warn("[sse] stream/batches poll failed", err instanceof Error ? err.message : err);
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
}
