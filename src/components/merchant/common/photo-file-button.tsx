"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CameraIcon, Loader2Icon, XIcon } from "lucide-react";
import { DEMO_BATCH_PHOTO_TTL_MINUTES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { compressPhoto } from "../lib/compress-photo";

/**
 * A button that opens the back camera (or the photo picker on desktop), compresses the
 * photo on the phone and hands over the JPEG. The file input sits inside the label, so it
 * keeps keyboard focus and its accessible name.
 */
export function PhotoFileButton({
  children,
  onPicked,
  disabled = false,
  busy = false,
  className,
}: {
  children: React.ReactNode;
  onPicked: (jpeg: Blob) => void;
  disabled?: boolean;
  /** Shows a spinner, e.g. while the parent uploads. */
  busy?: boolean;
  className?: string;
}) {
  const [compressing, setCompressing] = useState(false);
  const working = busy || compressing;

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    // Reset so picking the same photo again still fires a change.
    input.value = "";
    if (!file) return;
    setCompressing(true);
    try {
      onPicked(await compressPhoto(file));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Foto tidak bisa dibaca.");
    } finally {
      setCompressing(false);
    }
  };

  return (
    <label
      aria-disabled={disabled || working || undefined}
      className={cn(
        "relative inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold ring-1 ring-border transition-colors hover:bg-muted has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-ring/50",
        (disabled || working) && "pointer-events-none opacity-60",
        className,
      )}
    >
      <input
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        disabled={disabled || working}
        onChange={(e) => void onChange(e)}
      />
      {working ? <Loader2Icon className="size-4 animate-spin" aria-hidden /> : <CameraIcon className="size-4" aria-hidden />}
      <span>{compressing ? "Mengecilkan foto…" : children}</span>
    </label>
  );
}

/** The photo chosen in the publisher, kept until the batch exists and the upload runs. */
export type PendingPhoto = { jpeg: Blob; previewUrl: string };

/**
 * State for a PendingPhoto: creates the preview object URL when a photo is picked and
 * revokes it when the photo is replaced, cleared, or the component unmounts.
 */
export function usePendingPhoto(): [PendingPhoto | null, (jpeg: Blob | null) => void] {
  const [photo, setPhoto] = useState<PendingPhoto | null>(null);
  const latest = useRef<PendingPhoto | null>(null);
  useEffect(
    () => () => {
      if (latest.current) URL.revokeObjectURL(latest.current.previewUrl);
    },
    [],
  );
  const set = useCallback((jpeg: Blob | null) => {
    if (latest.current) URL.revokeObjectURL(latest.current.previewUrl);
    const next = jpeg ? { jpeg, previewUrl: URL.createObjectURL(jpeg) } : null;
    latest.current = next;
    setPhoto(next);
  }, []);
  return [photo, set];
}

/**
 * "Foto etalase malam ini" in the publisher: optional, compressed now and uploaded right
 * after the batch is published (publishing never waits for it). States who will see it.
 */
export function BatchPhotoField({
  value,
  onChange,
  isDemo,
  isPilot,
}: {
  value: PendingPhoto | null;
  onChange: (jpeg: Blob | null) => void;
  isDemo: boolean;
  isPilot: boolean;
}) {
  return (
    <div>
      {value ? (
        <div className="flex items-center gap-3">
          {/* A local preview of the compressed photo (blob: URL). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value.previewUrl} alt="Pratinjau foto etalase" className="size-20 shrink-0 rounded-2xl object-cover ring-1 ring-border" />
          <div className="flex flex-wrap gap-2">
            <PhotoFileButton onPicked={onChange}>Ganti foto</PhotoFileButton>
            <button
              type="button"
              onClick={() => onChange(null)}
              className="inline-flex h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <XIcon className="size-4" aria-hidden /> Hapus foto
            </button>
          </div>
        </div>
      ) : (
        <PhotoFileButton onPicked={onChange}>Ambil foto etalase</PhotoFileButton>
      )}
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{photoAudienceText({ isDemo, isPilot })}</p>
    </div>
  );
}

/** Who will see a photo this warung uploads (amendment A visibility), in the warung's words. */
export function photoAudienceText({ isDemo, isPilot }: { isDemo: boolean; isPilot: boolean }): string {
  if (isDemo) {
    return `Akun demo: foto hanya terlihat oleh akun demo dan dihapus ${DEMO_BATCH_PHOTO_TTL_MINUTES} menit setelah diunggah atau saat batch berakhir.`;
  }
  if (isPilot) return "Pembeli melihat foto ini dengan keterangan jam unggahnya. Foto dihapus saat batch berakhir.";
  return "Foto etalase tampil ke pembeli khusus warung pilot. Untuk warungmu, foto ini jadi pratinjau yang hanya kamu lihat.";
}
