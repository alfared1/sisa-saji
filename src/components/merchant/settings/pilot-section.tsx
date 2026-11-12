"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FlaskConicalIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiClientError, api } from "@/lib/api/client";
import type { MerchantMeResponse, MerchantProfile } from "@/lib/contracts";
import { MERCHANT_ME_QUERY_KEY } from "../lib/queries";
import { SectionCard } from "../ui";

function joinedLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" });
}

/**
 * Field pilot: a real warung enters the invite code from the Sisa-Saji team. From then
 * on its customers pay at the counter and its verified pickups count in /uji-coba.
 */
export function PilotSection({ merchant }: { merchant: MerchantProfile }) {
  const qc = useQueryClient();
  const inputId = useId();
  const [code, setCode] = useState("");
  const join = useMutation({
    mutationFn: () => api.post<MerchantMeResponse>("/merchant/pilot", { code }),
    onSuccess: (res) => {
      qc.setQueryData(MERCHANT_ME_QUERY_KEY, res);
      setCode("");
      toast.success("Warungmu resmi ikut uji coba", { description: "Pembeli akan membayar langsung di warung." });
    },
    onError: (err) => toast.error(err instanceof ApiClientError ? err.message : "Gagal bergabung. Coba lagi."),
  });

  if (merchant.is_pilot) {
    return (
      <SectionCard title="Uji coba lapangan" icon={FlaskConicalIcon}>
        <p className="text-sm leading-relaxed">
          Warungmu ikut uji coba
          {merchant.pilot_joined_at ? ` sejak ${joinedLabel(merchant.pilot_joined_at)}` : ""}. Pembeli membayar langsung di
          warung saat mengambil, tanpa biaya layanan.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Setiap pesanan yang kamu verifikasi saat diambil tercatat sebagai porsi terselamatkan di halaman hasil uji coba.
        </p>
        <Link href="/uji-coba" className="mt-3 inline-flex h-11 items-center text-sm font-bold text-primary hover:underline">
          Lihat hasil uji coba
        </Link>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Uji coba lapangan"
      icon={FlaskConicalIcon}
      description="Untuk warung yang diundang tim Sisa-Saji. Pembeli membayar langsung di warung."
    >
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) join.mutate();
        }}
      >
        <Label htmlFor={inputId} className="text-sm font-semibold">
          Kode undangan
        </Label>
        <div className="flex gap-2">
          <Input
            id={inputId}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            className="h-11 rounded-xl"
            placeholder="Dari tim Sisa-Saji"
          />
          <Button type="submit" className="h-11 shrink-0 rounded-xl px-4 font-bold" disabled={!code.trim() || join.isPending}>
            {join.isPending && <Loader2Icon className="animate-spin" aria-hidden />} Gabung
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
