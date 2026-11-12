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
import { MAX_NIGHTLY_PORTIONS, type MerchantMeResponse, type MerchantProfile } from "@/lib/contracts";
import { MERCHANT_ME_QUERY_KEY } from "../lib/queries";
import { SectionCard } from "../ui";

function joinedLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" });
}

/** Whole portions 0..MAX_NIGHTLY_PORTIONS from a text field, or null when empty or invalid. */
function parsePortions(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n <= MAX_NIGHTLY_PORTIONS ? n : null;
}

const BASELINE_QUESTION = "Sebelum pakai Sisa-Saji, biasanya berapa porsi tersisa per malam?";
const BASELINE_HINT =
  "Perkiraan saja, misalnya rata-rata seminggu terakhir. Angka ini dipakai untuk menghitung berapa sampah warungmu berkurang, dan tidak bisa diubah setelah disimpan.";

function BaselineField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm font-semibold">
        {BASELINE_QUESTION}
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          className="h-11 w-28 rounded-xl text-base tabular-nums"
          aria-describedby={`${id}-hint`}
        />
        <span className="text-sm text-muted-foreground">porsi per malam</span>
      </div>
      <p id={`${id}-hint`} className="text-xs leading-relaxed text-muted-foreground">
        {BASELINE_HINT}
      </p>
    </div>
  );
}

/**
 * Field pilot: a real warung enters the invite code from the Sisa-Saji team and how many
 * portions it usually had left before. From then on its customers pay at the counter, and
 * its verified pickups and leftover reports count in /uji-coba.
 */
export function PilotSection({ merchant }: { merchant: MerchantProfile }) {
  const qc = useQueryClient();
  const codeId = useId();
  const baselineId = useId();
  const [code, setCode] = useState("");
  const [baseline, setBaseline] = useState("");
  const portions = parsePortions(baseline);

  const onSaved = (res: MerchantMeResponse) => qc.setQueryData(MERCHANT_ME_QUERY_KEY, res);
  const onError = (err: Error) => toast.error(err instanceof ApiClientError ? err.message : "Gagal menyimpan. Coba lagi.");

  const join = useMutation({
    mutationFn: () => api.post<MerchantMeResponse>("/merchant/pilot", { code, baseline_leftover_portions: portions }),
    onSuccess: (res) => {
      onSaved(res);
      setCode("");
      setBaseline("");
      toast.success("Warungmu resmi ikut uji coba", { description: "Pembeli akan membayar langsung di warung." });
    },
    onError,
  });
  const saveBaseline = useMutation({
    mutationFn: () => api.patch<MerchantMeResponse>("/merchant/pilot", { baseline_leftover_portions: portions }),
    onSuccess: (res) => {
      onSaved(res);
      setBaseline("");
      toast.success("Angka sebelum uji coba tersimpan");
    },
    onError,
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
          Setiap pesanan yang kamu verifikasi saat diambil, dan laporan sisa setiap malam di dasbor, masuk ke halaman hasil uji
          coba.
        </p>
        {merchant.pilot_baseline_leftover_portions !== null ? (
          <p className="mt-3 rounded-2xl bg-muted px-3 py-2 text-sm">
            Sebelum uji coba: sekitar <b className="tabular-nums">{merchant.pilot_baseline_leftover_portions}</b> porsi tersisa per
            malam.
          </p>
        ) : (
          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (portions !== null) saveBaseline.mutate();
            }}
          >
            <BaselineField id={baselineId} value={baseline} onChange={setBaseline} />
            <Button type="submit" className="h-11 rounded-xl px-4 font-bold" disabled={portions === null || saveBaseline.isPending}>
              {saveBaseline.isPending && <Loader2Icon className="animate-spin" aria-hidden />} Simpan
            </Button>
          </form>
        )}
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
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim() && portions !== null) join.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor={codeId} className="text-sm font-semibold">
            Kode undangan
          </Label>
          <Input
            id={codeId}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            className="h-11 rounded-xl"
            placeholder="Dari tim Sisa-Saji"
          />
        </div>
        <BaselineField id={baselineId} value={baseline} onChange={setBaseline} />
        <Button type="submit" className="h-11 rounded-xl px-5 font-bold" disabled={!code.trim() || portions === null || join.isPending}>
          {join.isPending && <Loader2Icon className="animate-spin" aria-hidden />} Gabung
        </Button>
      </form>
    </SectionCard>
  );
}
