/**
 * Route-handler helpers: response envelope, typed errors, input parsing.
 *
 *   export const POST = handle(async (req) => {
 *     const user = await requireUser();
 *     const body = await parseJson(req, CheckoutBody);
 *     return ok({ order });
 *   });
 */
import "server-only";
import { ZodError, type ZodType } from "zod";
import type { ApiFailure, ApiSuccess, ErrorCode } from "@/lib/contracts";

const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  INVALID_SIGNATURE: 401,
  FORBIDDEN: 403,
  MERCHANT_REQUIRED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  OUT_OF_STOCK: 409,
  BATCH_CLOSED: 409,
  DIFFERENT_MERCHANT: 409,
  ORDER_STATE_CONFLICT: 409,
  PAYMENT_EXPIRED: 410,
  PICKUP_WINDOW_CLOSED: 409,
  OTP_INVALID: 400,
  OTP_EXPIRED: 400,
  OTP_DELIVERY_FAILED: 503,
  INVALID_PICKUP_CODE: 400,
  VOUCHER_INVALID: 400,
  RATE_LIMITED: 429,
  DB_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
    public readonly status: number = STATUS_BY_CODE[code] ?? 400,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function ok<T>(data: T, init?: { status?: number; meta?: Record<string, unknown>; headers?: HeadersInit }) {
  const body: ApiSuccess<T> = { success: true, data, ...(init?.meta ? { meta: init.meta } : {}) };
  return Response.json(body, { status: init?.status ?? 200, headers: init?.headers });
}

export function fail(code: ErrorCode, message: string, details?: unknown, status?: number) {
  const body: ApiFailure = { success: false, error: { code, message, ...(details !== undefined ? { details } : {}) } };
  return Response.json(body, { status: status ?? STATUS_BY_CODE[code] ?? 400 });
}

function zodDetails(err: ZodError) {
  return err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

export async function parseJson<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError("VALIDATION_ERROR", "Body harus berupa JSON yang valid");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "Input tidak valid", zodDetails(parsed.error));
  return parsed.data;
}

export function parseQuery<T>(req: Request, schema: ZodType<T>): T {
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  const parsed = schema.safeParse(params);
  if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "Parameter tidak valid", zodDetails(parsed.error));
  return parsed.data;
}

export function parseUuid(value: string, what = "id"): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new ApiError("NOT_FOUND", `${what} tidak ditemukan`);
  }
  return value;
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Wraps a route handler: maps ApiError/ZodError to the error envelope, hides internals. */
export function handle<C = unknown>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof ApiError) return fail(err.code, err.message, err.details, err.status);
      if (err instanceof ZodError) return fail("VALIDATION_ERROR", "Input tidak valid", zodDetails(err));
      // Next.js control-flow errors (redirect/notFound/dynamic usage) must propagate.
      if (err && typeof err === "object" && "digest" in err) throw err;
      console.error(`[api] ${req.method} ${new URL(req.url).pathname} failed`, err);
      return fail("INTERNAL_ERROR", "Terjadi kesalahan pada server");
    }
  };
}
