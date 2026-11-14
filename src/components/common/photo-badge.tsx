import { CameraIcon } from "lucide-react";
import type { BatchPhotoMeta } from "@/lib/contracts";
import { formatClockId } from "@/lib/time";
import { cn } from "@/lib/utils";

/**
 * Says when tonight's batch photo was taken, and whose it is. Only for a real batch photo
 * (BatchCard.photo), never for a menu image or a placeholder, and only while that photo is
 * on screen (see FoodThumb `photoOverlay` / `onPhotoError`).
 *  - kind "real" (pilot warung): "Foto asli 19.45" on the image, "Foto asli etalase pukul 19.45 WIB" as a line;
 *  - kind "demo" (shared demo account): "Contoh 19.45" / "Foto contoh akun demo, 19.45". Never "Foto asli".
 */
export function PhotoBadge({
  photo,
  variant,
  className,
}: {
  photo: Pick<BatchPhotoMeta, "uploaded_at" | "kind">;
  variant: "overlay" | "line";
  className?: string;
}) {
  const time = formatClockId(photo.uploaded_at);
  const demo = photo.kind === "demo";

  if (variant === "overlay") {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold leading-tight text-white tabular-nums",
          className,
        )}
      >
        {demo ? `Contoh ${time}` : `Foto asli ${time}`}
      </span>
    );
  }

  return (
    <p className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
      <CameraIcon className="size-3.5 shrink-0" aria-hidden />
      <span>{demo ? `Foto contoh akun demo, ${time}` : `Foto asli etalase pukul ${time} WIB`}</span>
    </p>
  );
}
