"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2Icon } from "lucide-react";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { errorMessage } from "@/components/common/error-state";
import { FoodThumb } from "@/components/customer/food-thumb";
import { api } from "@/lib/api/client";
import type { MenuResponse, MenuView } from "@/lib/contracts";
import { PhotoFileButton } from "../common/photo-file-button";
import { postJpeg } from "../lib/batch-photo";

/**
 * "Foto menu": the warung's own photo of a menu, kept for every night. Buyers see it for field
 * pilot warung; for other warung it is a preview only the owner sees (same rule as batch photos).
 */
export function MenuPhotoField({ menu, isPilot, onChanged }: { menu: MenuView; isPilot: boolean; onChanged: (menu: MenuView) => void }) {
  const [confirm, setConfirm] = useState(false);
  const upload = useMutation({
    mutationFn: (jpeg: Blob) => postJpeg<MenuResponse>(`/merchant/menus/${menu.id}/photo`, jpeg),
    onSuccess: (res) => {
      onChanged(res.menu);
      toast.success("Foto menu tersimpan", { id: `menu-photo-${menu.id}` });
    },
    onError: (err) => toast.error(errorMessage(err, "Gagal mengunggah foto."), { id: `menu-photo-${menu.id}` }),
  });
  const remove = useMutation({
    mutationFn: () => api.del<MenuResponse>(`/merchant/menus/${menu.id}/photo`),
    onSuccess: (res) => {
      setConfirm(false);
      onChanged(res.menu);
      toast("Foto menu dihapus");
    },
    onError: (err) => toast.error(errorMessage(err, "Gagal menghapus foto.")),
  });

  return (
    <section aria-label="Foto menu" className="mt-4 rounded-2xl bg-surface p-3 ring-1 ring-border">
      <div className="flex items-center gap-3">
        <FoodThumb
          category={menu.category}
          imageUrl={menu.image_url}
          alt={menu.image_url ? `Foto ${menu.menu_name}` : ""}
          className="size-20 shrink-0 rounded-2xl"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Foto menu</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {isPilot ? "Pembeli melihat foto ini di menumu." : "Foto tampil ke pembeli setelah warungmu ikut uji coba. Sekarang hanya kamu yang melihatnya."}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <PhotoFileButton onPicked={(jpeg) => upload.mutate(jpeg)} busy={upload.isPending} className="h-10 bg-card text-xs">
              {upload.isPending ? "Mengunggah…" : menu.image_url ? "Ganti foto" : "Tambah foto"}
            </PhotoFileButton>
            {menu.image_url && (
              <button
                type="button"
                onClick={() => setConfirm(true)}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <Trash2Icon className="size-4" aria-hidden /> Hapus
              </button>
            )}
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={(o) => !remove.isPending && setConfirm(o)}
        destructive
        title="Hapus foto menu?"
        description="Menu ini kembali memakai gambar pengganti."
        confirmLabel="Ya, hapus"
        cancelLabel="Batal"
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </section>
  );
}
