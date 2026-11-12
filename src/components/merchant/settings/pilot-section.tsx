"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FlaskConicalIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiClientError, api } from "@/lib/api/client";
import { MAX_NIGHTLY_PORTIONS, type MerchantMeResponse, type MerchantProfile, type PilotAvailability } from "@/lib/contracts";
import { DemoLockNotice } from "@/components/common/demo-lock-notice";
import { MERCHANT_ME_QUERY_KEY, useMerchantReady } from "../lib/queries";
import { SectionCard } from "../ui";

export const PILOT_AVAILABILITY_QUERY_KEY = ["merchant", "pilot"] as const;

function joinedLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" });
}

/** Whole portions 0..MAX_NIGHTLY_PORTIONS from a text field, or null when empty or invalid. */
function parsePortions(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n <= MAX_NIGHTLY_PORTIONS ? n : null;
}

/*
 * The baseline asks only for portions THROWN AWAY, because the nightly report's "Dibuang"
 * count is what it is compared with (portions given away, fed to animals or composted are
 * not waste on either side).
 */
const BASELINE_QUESTION = "Sebelum pakai Sisa-Saji, biasanya berapa porsi yang dibuang per malam?";
const BASELINE_HINT =
  "Hitung yang masuk tempat sampah saja, bukan yang dibagikan, jadi pakan, atau dikompos. Perkiraan saja, misalnya rata-rata seminggu terakhir. Angka ini dibandingkan dengan porsi dibuang di laporan sisa setiap malam, dan tidak bisa diubah setelah disimpan.";
const SELF_REPORTED_NOTE =
  "Angka sebelum uji coba dan laporan sisa setiap malam kamu isi sendiri. Di halaman hasil uji coba, angkanya ditulis sebagai laporan warung.";

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
        <span className="text-sm text-muted-foreground">porsi dibuang per malam</span>
      </div>
      <p id={`${id}-hint`} className="text-xs leading-relaxed text-muted-foreground">
        {BASELINE_HINT}
      </p>
    </div>
  );
}

/** "Sisa-Saji" that never breaks at its hyphen. */
const Brand = () => <span className="whitespace-nowrap">Sisa-Saji</span>;

/** Why the join form is not offered (on-screen login codes, pilot closed), or null. Demo accounts are handled apart. */
function blockedNotice(a: PilotAvailability): { title: string; body: React.ReactNode } | null {
  if (!a.real_otp_delivery) {
    return {
      title: "Belum bisa bergabung",
      body: "Uji coba lapangan butuh kode masuk yang dikirim lewat WhatsApp atau email. Di versi demo ini kode masih tampil di layar, jadi pendaftaran dibuka setelah pengiriman kode aktif.",
    };
  }
  if (!a.invite_open) {
    return {
      title: "Uji coba belum dibuka",
      body: (
        <>
          Tim <Brand /> akan memberi kode undangan ke warung yang diajak ikut.
        </>
      ),
    };
  }
  return null;
}

/** Bank account payouts go to, so the owner checks it is theirs before joining for real. */
function PayoutCheck({ merchant }: { merchant: MerchantProfile }) {
  return (
    <div className="rounded-2xl bg-muted px-3 py-2.5 text-xs leading-relaxed">
      <p className="font-semibold text-foreground">Periksa rekening pencairan</p>
      {merchant.bank_account_number_masked ? (
        <p className="mt-0.5 text-muted-foreground">
          {merchant.bank_code ?? "Bank"} <span className="tabular-nums">{merchant.bank_account_number_masked}</span>
          {merchant.bank_account_holder ? ` a.n. ${merchant.bank_account_holder}` : ""}. Pastikan ini rekening warungmu sendiri.
          Kalau bukan, ubah dulu di bagian Rekening.
        </p>
      ) : (
        <p className="mt-0.5 text-muted-foreground">Belum ada rekening. Isi dulu di bagian Rekening sebelum bergabung.</p>
      )}
    </div>
  );
}

/**
 * Field pilot: a real warung enters the invite code from the Sisa-Saji team and how many
 * portions it usually threw away per night before. From then on its customers pay at the
 * counter, and its verified pickups and leftover reports count in /uji-coba. The form is
 * only offered when the server allows joining (GET /merchant/pilot).
 */
export function PilotSection({ merchant }: { merchant: MerchantProfile }) {
  const qc = useQueryClient();
  const ready = useMerchantReady();
  const codeId = useId();
  const baselineId = useId();
  const [code, setCode] = useState("");
  const [baseline, setBaseline] = useState("");
  const portions = parsePortions(baseline);

  const availability = useQuery({
    queryKey: PILOT_AVAILABILITY_QUERY_KEY,
    queryFn: () => api.get<PilotAvailability>("/merchant/pilot"),
    enabled: ready && !merchant.is_pilot,
    staleTime: 60_000,
  });

  const onSaved = (res: MerchantMeResponse) => qc.setQueryData(MERCHANT_ME_QUERY_KEY, res);
  const onError = (err: Error) => {
    toast.error(err instanceof ApiClientError ? err.message : "Gagal menyimpan. Coba lagi.");
    // The server may have refused because joining is no longer possible: refresh the card.
    void qc.invalidateQueries({ queryKey: PILOT_AVAILABILITY_QUERY_KEY });
  };

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
            Sebelum uji coba: sekitar <b className="tabular-nums">{merchant.pilot_baseline_leftover_portions}</b> porsi dibuang per
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
            <Button type="submit" className="h-11 rounded-xl px-4 font-semibold" disabled={portions === null || saveBaseline.isPending}>
              {saveBaseline.isPending && <Loader2Icon className="animate-spin" aria-hidden />} Simpan
            </Button>
          </form>
        )}
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{SELF_REPORTED_NOTE}</p>
        <Link href="/uji-coba" className="mt-1 inline-flex h-11 items-center text-sm font-semibold text-primary hover:underline">
          Lihat hasil uji coba
        </Link>
      </SectionCard>
    );
  }

  const blocked = availability.data ? blockedNotice(availability.data) : null;

  return (
    <SectionCard
      title="Uji coba lapangan"
      icon={FlaskConicalIcon}
      description={
        <>
          Untuk warung yang diundang tim <Brand />. Pembeli membayar langsung di warung.
        </>
      }
    >
      {availability.isPending ? (
        <Skeleton className="h-28 rounded-2xl" aria-label="Memuat status uji coba" />
      ) : availability.isError ? (
        <p className="text-sm text-muted-foreground">
          Status uji coba belum bisa dimuat.{" "}
          <button type="button" className="font-semibold text-primary hover:underline" onClick={() => void availability.refetch()}>
            Coba lagi
          </button>
        </p>
      ) : availability.data?.demo_locked ? (
        <DemoLockNotice message="Uji coba lapangan tidak tersedia untuk akun demo." />
      ) : blocked ? (
        <div role="note" className="rounded-2xl bg-warning-soft px-4 py-3 text-sm leading-relaxed ring-1 ring-warning/30">
          <p className="font-semibold">{blocked.title}</p>
          <p className="mt-1 text-foreground/85">{blocked.body}</p>
        </div>
      ) : (
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
          <PayoutCheck merchant={merchant} />
          <p className="text-xs leading-relaxed text-muted-foreground">{SELF_REPORTED_NOTE}</p>
          <Button type="submit" className="h-11 rounded-xl px-5 font-semibold" disabled={!code.trim() || portions === null || join.isPending}>
            {join.isPending && <Loader2Icon className="animate-spin" aria-hidden />} Gabung
          </Button>
        </form>
      )}
    </SectionCard>
  );
}
