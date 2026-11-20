"use client";

import Link from "next/link";
import { LifeBuoyIcon } from "lucide-react";
import { PAYMENT_TTL_SECONDS } from "@/lib/constants";
import { SectionCard } from "../ui";

/** Answers taken from how the app works (docs/ARCHITECTURE.md), not generic FAQ. */
const TOPICS = [
  {
    q: "Kapan uang masuk ke saldo?",
    a: "Saat kamu memverifikasi kode atau QR pembeli yang bayar online. Kalau pembeli tidak datang, uangnya tetap masuk 30 menit setelah batas ambil. Cairkan dari halaman Saldo.",
  },
  {
    q: "Stoknya habis padahal sudah ada yang pesan?",
    a: "Buka Pesanan, lalu pilih Stok habis di pesanan itu. Pembeli otomatis dapat uangnya kembali penuh, dan sisa stok menu itu jadi 0.",
  },
  {
    q: "Pembeli minta batal, harus bagaimana?",
    a: "Kamu yang memutuskan di halaman Pesanan. Setujui kalau porsinya belum disiapkan: uang pembeli kembali dan porsinya dijual lagi. Tolak dengan alasan kalau sudah dibungkus.",
  },
  {
    q: "Apa itu harga minimum?",
    a: "Harga terendah yang masih mau kamu terima untuk menu itu. Diskon otomatis maupun diskon yang kamu atur sendiri tidak pernah turun di bawahnya.",
  },
  {
    q: "Berapa lama porsi dikunci saat pembeli bayar?",
    a: `${PAYMENT_TTL_SECONDS / 60} menit. Kalau pembeli tidak membayar dalam waktu itu, porsinya kembali ke stok.`,
  },
] as const;

const SUPPORT_WHATSAPP = process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP?.replace(/\D/g, "") ?? "";

export function HelpSection() {
  return (
    <SectionCard title="Bantuan" icon={LifeBuoyIcon}>
      <div className="divide-y divide-border">
        {TOPICS.map((t) => (
          <details key={t.q} className="group py-1">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
              {t.q}
              <span aria-hidden className="text-muted-foreground transition-transform group-open:rotate-45">
                +
              </span>
            </summary>
            <p className="pb-3 text-sm leading-relaxed text-muted-foreground">{t.a}</p>
          </details>
        ))}
      </div>
      <div className="mt-3 grid gap-2">
        {SUPPORT_WHATSAPP && (
          <a
            href={`https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent("Halo tim Sisa-Saji, saya penjual dan butuh bantuan.")}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground"
          >
            Chat tim Sisa-Saji
          </a>
        )}
        <Link href="/tour?peran=mitra" className="inline-flex h-11 items-center justify-center rounded-xl bg-card text-sm font-semibold ring-1 ring-border hover:bg-muted">
          Lihat tur penjual
        </Link>
      </div>
    </SectionCard>
  );
}
