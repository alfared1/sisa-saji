import Link from "next/link";
import { LeafIcon, QrCodeIcon, TimerIcon } from "lucide-react";
import { Logo } from "@/components/common/logo";

/** Auth frame: brand panel on desktop, focused single column on mobile. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-backdrop min-h-dvh lg:grid lg:grid-cols-[1fr_minmax(28rem,36rem)]">
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-[oklch(0.5_0.13_153)] to-[oklch(0.34_0.08_160)] p-12 text-white lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -top-24 -right-24 size-96 rounded-full bg-white/10 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-32 -left-20 size-96 rounded-full bg-[oklch(0.75_0.16_55)]/25 blur-3xl" aria-hidden />
        <Link href="/welcome" className="relative w-fit rounded-2xl bg-white/95 px-3 py-2 text-foreground">
          <Logo />
        </Link>
        <div className="relative mt-auto max-w-md space-y-6">
          <h2 className="text-4xl leading-tight font-extrabold">
            Porsi terakhir malam ini menunggu untuk diselamatkan.
          </h2>
          <ul className="space-y-3 text-sm text-white/85">
            <li className="flex items-center gap-3">
              <TimerIcon className="size-5 shrink-0" /> Diskon otomatis naik mendekati jam tutup warung.
            </li>
            <li className="flex items-center gap-3">
              <QrCodeIcon className="size-5 shrink-0" /> Bayar QRIS, ambil sendiri pakai tiket QR.
            </li>
            <li className="flex items-center gap-3">
              <LeafIcon className="size-5 shrink-0" /> Setiap porsi tercatat sebagai dampak CO₂e-mu.
            </li>
          </ul>
        </div>
      </aside>
      <div className="flex min-h-dvh flex-col">
        <header className="safe-top mx-auto flex h-16 w-full max-w-md items-center px-4 lg:hidden">
          <Link href="/welcome" aria-label="Kembali ke beranda Sisa-Saji">
            <Logo />
          </Link>
        </header>
        <main id="konten" className="safe-bottom mx-auto flex w-full max-w-md flex-1 flex-col px-4 pt-2 pb-10 lg:max-w-[32rem] lg:justify-center lg:pt-10">
          {children}
        </main>
      </div>
    </div>
  );
}
