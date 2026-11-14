"use client";

/**
 * Batch photo ("Foto etalase malam ini") requests and the dashboard cache updates that go
 * with them. The photo is compressed on the phone first (compress-photo.ts) and sent as a
 * raw JPEG body, which the shared JSON client does not do.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiClientError, api } from "@/lib/api/client";
import type { ApiResponse, BatchPhotoResponse, BatchPhotoVisibility, MerchantBatchView, MerchantDashboard } from "@/lib/contracts";
import { formatClockId } from "@/lib/time";
import { merchantKeys } from "./queries";

/** POST /merchant/surplus/:id/photo with the compressed JPEG. Throws ApiClientError like `api`. */
export async function uploadBatchPhoto(batchId: string, jpeg: Blob): Promise<BatchPhotoResponse> {
  let res: Response;
  try {
    res = await fetch(api.url(`/merchant/surplus/${batchId}/photo`), {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "image/jpeg" },
      body: jpeg,
    });
  } catch {
    throw new ApiClientError("NETWORK_ERROR", "Tidak dapat terhubung ke server. Periksa koneksi internet.", 0);
  }
  let json: ApiResponse<BatchPhotoResponse> | null = null;
  try {
    json = (await res.json()) as ApiResponse<BatchPhotoResponse>;
  } catch {
    /* non-JSON response (e.g. a proxy refusing the body) */
  }
  if (!json) {
    throw new ApiClientError(
      res.status === 413 ? "VALIDATION_ERROR" : "INTERNAL_ERROR",
      res.status === 413 ? "Foto terlalu besar. Coba foto ulang." : `Respons server tidak valid (${res.status})`,
      res.status,
    );
  }
  if (!json.success) throw new ApiClientError(json.error.code, json.error.message, res.status, json.error.details);
  return json.data;
}

export function deleteBatchPhoto(batchId: string): Promise<BatchPhotoResponse> {
  return api.del<BatchPhotoResponse>(`/merchant/surplus/${batchId}/photo`);
}

/** Writes a photo change into the dashboard's copy of the batch. */
export function patchBatchPhotoInCache(old: MerchantDashboard | undefined, batchId: string, res: BatchPhotoResponse) {
  if (!old) return old;
  return {
    ...old,
    active_batches: old.active_batches.map(
      (b): MerchantBatchView => (b.id === batchId ? { ...b, photo: res.photo, photo_uploads_left: res.photo_uploads_left } : b),
    ),
  };
}

/** Upload and delete mutations that keep the dashboard cache in sync. */
export function useBatchPhotoMutations() {
  const qc = useQueryClient();
  const onPhoto = (batchId: string, res: BatchPhotoResponse) => {
    qc.setQueryData<MerchantDashboard>(merchantKeys.dashboard, (old) => patchBatchPhotoInCache(old, batchId, res));
  };
  const upload = useMutation({
    mutationFn: ({ batchId, jpeg }: { batchId: string; jpeg: Blob }) => uploadBatchPhoto(batchId, jpeg),
    onSuccess: (res, { batchId }) => onPhoto(batchId, res),
  });
  const remove = useMutation({
    mutationFn: (batchId: string) => deleteBatchPhoto(batchId),
    onSuccess: (res, batchId) => onPhoto(batchId, res),
  });
  return { upload, remove };
}

/** Who sees the photo, for the warung (never shown to buyers). */
export function photoVisibilityText(photo: { visibility: BatchPhotoVisibility; expires_at: string | null }): string {
  switch (photo.visibility) {
    case "PUBLIC":
      return "Terlihat oleh pembeli.";
    case "DEMO":
      return photo.expires_at
        ? `Hanya terlihat oleh akun demo, sampai pukul ${formatClockId(photo.expires_at)}.`
        : "Hanya terlihat oleh akun demo.";
    case "OWNER":
      return "Pratinjau, hanya kamu yang melihat. Foto tampil ke pembeli khusus warung pilot.";
  }
}
