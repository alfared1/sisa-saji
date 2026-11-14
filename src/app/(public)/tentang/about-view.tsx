"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRightIcon, ChevronDownIcon } from "lucide-react";
import { DemoLoginButtons } from "@/components/common/demo-login-buttons";
import { Logo } from "@/components/common/logo";
import { ThemeToggle } from "@/components/common/theme-switcher";
import { useGlobalStats } from "@/hooks/use-global-stats";
import {
  CO2E_PER_KG_FOOD,
  DEFAULT_PORTION_WEIGHT_GRAMS,
  DEFAULT_SEARCH_RADIUS_M,
  DISCOUNT_BASELINE_PCT,
  HUNGER_ALERT_RADIUS_M,
  MERCHANT_PREMIUM_PRICE_IDR,
  PAY_AT_WARUNG_HOLD_MINUTES,
  PLATFORM_COMMISSION_DEFAULT_IDR,
} from "@/lib/constants";
import { CO2E_SOURCE } from "@/lib/impact";
import { formatIdr } from "@/lib/time";
import { ImpactStats } from "../welcome/welcome-view";
import { LICENCE_URL, PHOTO_CREDITS } from "./photo-credits";

/** Credit links stay visibly links on touch screens (no hover there). */
const CREDIT_LINK = "underline decoration-muted-foreground/50 underline-offset-2 hover:text-foreground hover:decoration-foreground";

const KM = DEFAULT_SEARCH_RADIUS_M / 1000;
const CO2_PER_PORTION_KG = (DEFAULT_PORTION_WEIGHT_GRAMS / 1000) * CO2E_PER_KG_FOOD;
const decimal = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 1 });

const STEPS = [
  {
    title: "Warung memasang porsi surplus",
    body: "Menjelang tutup, warung memasang menu yang belum laku dalam kurang dari satu menit, lengkap dengan isi porsi, lauk yang tersisa, dan harga terendah yang masih mau ia terima.",
  },
  {
    title: "Harga menyesuaikan sendiri",
    body: `Mulai dari diskon ${DISCOUNT_BASELINE_PCT}%, lalu naik mendekati jam tutup sampai harga terendah warung. Pembeli dalam radius ${KM} km melihatnya, dan yang menyalakan Notifikasi Jam Lapar dikabari sekali semalam saat warung dalam ${HUNGER_ALERT_RADIUS_M} m dari kosnya buka diskon malam.`,
  },
  {
    title: "Pembeli kunci porsi dan ambil sendiri",
    body: `Porsi dikunci selama pembeli membayar QRIS, atau ditahan ${PAY_AT_WARUNG_HOLD_MINUTES} menit kalau ia memilih bayar tunai di warung. Pembeli datang ke warung dan menunjukkan QR atau kode. Tidak ada kurir, jadi tidak ada ongkir.`,
  },
  {
    title: "Sisa terakhir tetap dicatat",
    body: "Porsi yang tetap tidak laku dicatat warung setiap malam: dibagikan, jadi pakan ternak atau maggot, dikompos, atau dibuang. Dari sini terlihat berapa sampah yang benar-benar berkurang.",
  },
] as const;

const TECH = [
  {
    title: "Prediksi surplus",
    body: "Model machine learning (LightGBM) memperkirakan berapa porsi akan tersisa malam ini dari riwayat penjualan, hari, dan perkiraan hujan malam di lokasi warung. Warung membacanya dalam kalimat biasa, bukan angka model.",
  },
  {
    title: "Harga otomatis",
    body: "Aturan bertingkat dari sisa waktu, sisa porsi, dan jumlah pembeli aktif di sekitar warung. Harga tidak pernah turun di bawah batas yang dipasang warung.",
  },
  {
    title: "Pencarian berbasis lokasi",
    body: `Warung dalam radius ${KM} km dicari langsung di database dengan PostGIS, lalu diurutkan dari yang terdekat.`,
  },
  {
    title: "Stok tidak terjual dua kali",
    body: "Porsi dikunci dalam satu transaksi database saat checkout dan dilepas otomatis kalau pembayaran tidak selesai dalam 10 menit.",
  },
  {
    title: "Tiket tanpa sinyal",
    body: "Aplikasi web yang bisa dipasang di HP. QR dan kode pengambilan tetap terbuka walau sinyal di warung hilang.",
  },
] as const;

/**
 * Results of the team's own survey, exactly as the owner reported them. No month or year is
 * known, so none is stated. Do not add numbers that are not here.
 */
const RESEARCH = [
  {
    title: "Ingin memilih sendiri",
    body: "60% ragu karena makanan sisa belum tentu cocok dengan selera, dan 48% lebih suka memilih menu sendiri daripada paket acak.",
  },
  {
    title: "Foto asli dan kebersihan",
    body: "Fitur yang paling dicari adalah foto asli makanan yang tersedia (58%) dan nilai kebersihan dari pembeli lain (58%).",
  },
  {
    title: "Diskon yang terasa",
    body: "78% menginginkan diskon di atas 20%, paling pas 30 sampai 50%. Untuk porsi normal Rp 20.000, 62% menilai Rp 8.000 sampai Rp 12.000 wajar menjelang tutup.",
  },
  {
    title: "Porsi tetap kenyang",
    body: "Porsi yang mengenyangkan jadi prioritas kedua (60%) setelah harga (78%), dan 34% khawatir porsinya lebih kecil.",
  },
  {
    title: "Dekat dan malam hari",
    body: "74% hanya mau ambil sendiri dalam 1 km (46% ingin di bawah 500 m), dan 48% enggan keluar malam. 78% mencari makan malam antara pukul 20.00 dan 23.00.",
  },
  {
    title: "Kepastian sebelum berangkat",
    body: "52% ingin hitung mundur sampai warung tutup, 42% ingin bisa memesan atau menahan porsi (26% takut kehabisan sebelum sampai), dan 56% ingin notifikasi saat ada diskon di dekatnya.",
  },
  {
    title: "Cara bayar",
    body: "QRIS dipilih 86% responden, tunai saat ambil 76%, GoPay 38%, dan DANA 30%.",
  },
  {
    title: "Alasan utama",
    body: "Hemat dan pasti kenyang. Mengurangi sampah pangan jadi nilai tambah, bukan alasan utama.",
  },
] as const;

const BUSINESS = [
  { value: formatIdr(PLATFORM_COMMISSION_DEFAULT_IDR), label: "biaya layanan per pesanan online, dibayar pembeli (tunai di warung tanpa biaya layanan)" },
  { value: "100%", label: "harga pemulihan diterima warung, tanpa potongan komisi" },
  { value: formatIdr(MERCHANT_PREMIUM_PRICE_IDR), label: "per bulan untuk Mitra Terverifikasi: badge dan urutan teratas" },
  { value: formatIdr(0), label: "ongkir, karena pembeli selalu mengambil sendiri" },
] as const;

const SDGS = [
  {
    goal: "SDG 12.3",
    title: "Sampah pangan",
    body: "Target mengurangi separuh sampah pangan per kapita di tingkat ritel dan konsumen pada 2030. Ini sasaran utama Sisa-Saji.",
  },
  {
    goal: "SDG 2.1",
    title: "Pangan terjangkau",
    body: "Makanan layak dengan harga jauh di bawah normal untuk mahasiswa dan warga sekitar warung.",
  },
  {
    goal: "SDG 11.6",
    title: "Sampah kota",
    body: "Lebih sedikit sampah organik ke TPA, tempat sisa makanan membusuk dan menghasilkan metana.",
  },
] as const;

function Section({ id, title, children, lead }: { id: string; title: string; lead?: ReactNode; children?: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-12">
      <h2 id={id} className="text-2xl font-bold">
        {title}
      </h2>
      {lead && <p className="mt-2 max-w-prose text-base leading-relaxed text-muted-foreground">{lead}</p>}
      {children && <div className="mt-5">{children}</div>}
    </section>
  );
}

/** /tentang: the whole product on one page, for anyone (a jury, a partner) who has two minutes. */
export function AboutView() {
  const stats = useGlobalStats();
  const demo = stats.data?.is_demo_data ?? false;

  return (
    <div className="app-backdrop min-h-dvh">
      <div className="mx-auto w-full max-w-4xl px-4 pb-16 lg:px-8">
        <header className="safe-top flex h-16 items-center justify-between">
          <Link href="/welcome" aria-label="Beranda Sisa-Saji" className="rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <Logo />
          </Link>
          <ThemeToggle />
        </header>

        <section className="pt-6 lg:pt-12">
          <h1 className="max-w-3xl text-[2rem] leading-[1.1] font-bold sm:text-5xl">
            Porsi surplus warung, terjual sebelum <span className="text-primary">terbuang</span>.
          </h1>
          <p className="mt-4 max-w-prose text-lg leading-relaxed text-muted-foreground">
            Sisa-Saji mempertemukan warung makan yang punya porsi belum laku menjelang tutup dengan pembeli di sekitarnya.
            Pembeli mendapat makanan dengan harga jauh lebih murah, warung tetap mendapat pemasukan, dan pangan tidak berakhir
            di tempat sampah.
          </p>
          <div className="mt-6 rounded-3xl bg-card p-4 ring-1 ring-border sm:p-5">
            <p className="font-semibold">Coba langsung, tanpa daftar</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {demo
                ? "Masuk ke akun contoh dengan satu ketukan. Warung dan pesanan di dalamnya adalah data demo."
                : "Lihat menu malam ini sebagai pembeli, atau daftarkan warungmu."}
            </p>
            <DemoLoginButtons demo={demo} className="mt-4" />
          </div>
        </section>

        <Section
          id="masalah"
          title="Masalahnya"
          lead={
            <>
              Bappenas (2021) memperkirakan Indonesia membuang 23 sampai 48 juta ton pangan setiap tahun pada 2000 sampai 2019,
              setara 115 sampai 184 kg per orang per tahun. Di warung kecil, porsi yang tidak laku sampai tutup biasanya dibuang:
              warung rugi bahan, padahal di sekitarnya banyak mahasiswa yang mencari makan malam murah.
            </>
          }
        />

        <Section
          id="riset"
          title="Riset pengguna"
          lead="Survei tim Sisa-Saji terhadap 50 mahasiswa di Kabupaten dan Kota Bogor. Angka di bawah adalah persentase responden. Hasilnya membentuk aplikasi ini: isi menu ditulis jelas, kebersihan dan porsi dinilai pembeli lain, jarak ke warung ditulis dalam meter dengan filter jalan kaki, dan porsi bisa dikunci sebelum berangkat."
        >
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {RESEARCH.map((r) => (
              <li key={r.title} className="rounded-2xl bg-card p-4 ring-1 ring-border">
                <p className="font-semibold">{r.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{r.body}</p>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="cara-kerja" title="Cara kerjanya">
          <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {STEPS.map((s, i) => (
              <li key={s.title} className="rounded-2xl bg-card p-4 ring-1 ring-border">
                <p className="text-sm font-extrabold text-primary tabular-nums">{i + 1}</p>
                <p className="mt-1 font-semibold">{s.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
        </Section>

        <Section
          id="dampak"
          title="Dampak yang dihitung"
          lead={
            <>
              Satu porsi dihitung {DEFAULT_PORTION_WEIGHT_GRAMS} g pangan dan mencegah sekitar {decimal(CO2_PER_PORTION_KG)} kg emisi
              CO₂e, memakai faktor {decimal(CO2E_PER_KG_FOOD)} kg CO₂e per kg pangan dari{" "}
              <a href={CO2E_SOURCE.url} target="_blank" rel="noreferrer" className="font-semibold text-primary underline-offset-2 hover:underline">
                {CO2E_SOURCE.label}
              </a>
              . Hanya pesanan yang benar-benar diambil dan diverifikasi warung yang dihitung.
            </>
          }
        >
          <div className="max-w-xl">
            <ImpactStats />
          </div>
        </Section>

        <Section id="teknologi" title="Teknologi di baliknya">
          <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-card ring-1 ring-border">
            {TECH.map((t) => (
              <li key={t.title} className="p-4">
                <p className="font-semibold">{t.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t.body}</p>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          id="bisnis"
          title="Model bisnis"
          lead="Warung kecil bermargin tipis, jadi warung tidak dipotong komisi. Pendapatan datang dari biaya layanan kecil yang dibayar pembeli dan langganan opsional untuk warung."
        >
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {BUSINESS.map((b) => (
              <li key={b.label} className="rounded-2xl bg-card p-4 ring-1 ring-border">
                <p className="text-2xl font-extrabold text-deal tabular-nums">{b.value}</p>
                <p className="mt-1 text-sm text-muted-foreground">{b.label}</p>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="sdgs" title="Tujuan Pembangunan Berkelanjutan">
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {SDGS.map((g) => (
              <li key={g.goal} className="rounded-2xl bg-card p-4 ring-1 ring-border">
                <p className="text-sm font-semibold text-primary">{g.goal}</p>
                <p className="mt-1 font-semibold">{g.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{g.body}</p>
              </li>
            ))}
          </ul>
        </Section>

        <section aria-labelledby="lanjut" className="mt-12 rounded-3xl bg-card p-5 ring-1 ring-border">
          <h2 id="lanjut" className="text-lg font-bold">
            Lihat lebih jauh
          </h2>
          <ul className="mt-2">
            {[
              { href: "/uji-coba", label: "Hasil uji coba di warung sungguhan" },
              { href: "/tour", label: "Tur 1 menit" },
              { href: "/welcome", label: "Beranda aplikasi" },
            ].map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
                  {l.label} <ArrowRightIcon className="size-4" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="sumber" className="mt-8 text-sm leading-relaxed text-muted-foreground">
          <h2 id="sumber" className="font-semibold text-foreground">
            Sumber
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <a href={CO2E_SOURCE.url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
                FAO (2013). Food Wastage Footprint: Impacts on Natural Resources.
              </a>{" "}
              3,3 Gt CO₂e dari 1,3 Gt pangan yang terbuang, sekitar 2,5 kg CO₂e per kg.
            </li>
            <li>Bappenas (2021). Laporan Kajian Food Loss and Waste di Indonesia.</li>
            <li>
              <a href="https://sdgs.un.org/goals/goal12" target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
                Perserikatan Bangsa-Bangsa. Goal 12: Ensure sustainable consumption and production patterns.
              </a>
            </li>
            <li>
              Foto buram untuk menu yang belum punya foto, dari Wikimedia Commons. Semuanya dipotong, diperkecil, dan
              diburamkan.
              <details className="group mt-1">
                <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-sm font-semibold text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
                  Kredit {PHOTO_CREDITS.length} foto
                  <ChevronDownIcon className="size-4 transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <ul className="mt-2 space-y-1.5">
                  {PHOTO_CREDITS.map((c) => (
                    <li key={c.sourceUrl}>
                      <span className="text-foreground">{c.usedFor}:</span>{" "}
                      <a href={c.sourceUrl} target="_blank" rel="noreferrer" className={`break-words ${CREDIT_LINK}`}>
                        {c.title.replace(/\.jpg$/i, "")}
                      </a>
                      , oleh {c.author},{" "}
                      <a href={LICENCE_URL[c.licence]} target="_blank" rel="noreferrer" className={CREDIT_LINK}>
                        {c.licence}
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
