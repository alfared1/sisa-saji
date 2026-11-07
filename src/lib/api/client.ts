/**
 * Browser-side API client for /api/v1 (cookie session, same origin).
 *
 *   const { merchants } = await api.get<NearbyResponse>("/discover/nearby", { lat, lng });
 *   await api.post<CheckoutResponse>("/orders/checkout", body);
 *
 * Throws ApiClientError (with the server's error code) on failure.
 */
import type { ApiResponse, ErrorCode } from "@/lib/contracts";

export class ApiClientError extends Error {
  constructor(
    public readonly code: ErrorCode | "NETWORK_ERROR",
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

function buildUrl(path: string, query?: Query): string {
  const url = `/api/v1${path.startsWith("/") ? path : `/${path}`}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      credentials: "same-origin",
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiClientError("NETWORK_ERROR", "Tidak dapat terhubung ke server. Periksa koneksi internet.", 0);
  }
  let json: ApiResponse<T> | null = null;
  try {
    json = (await res.json()) as ApiResponse<T>;
  } catch {
    /* non-JSON response */
  }
  if (!json) throw new ApiClientError("INTERNAL_ERROR", `Respons server tidak valid (${res.status})`, res.status);
  if (!json.success) throw new ApiClientError(json.error.code, json.error.message, res.status, json.error.details);
  return json.data;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>("GET", path, undefined, query),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {}),
  del: <T>(path: string) => request<T>("DELETE", path),
  url: buildUrl,
};
