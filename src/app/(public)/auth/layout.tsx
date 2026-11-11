import Link from "next/link";
import { LeafIcon, QrCodeIcon, TimerIcon } from "lucide-react";
import { Logo } from "@/components/common/logo";
import { ThemeToggle } from "@/components/common/theme-switcher";

/** Auth frame: brand panel on desktop, focused single column on mobile. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-backdrop min-h-dvh lg:grid lg:grid-cols-[1fr_minmax(28rem,36rem)]">
      <aside className="relative hidden bg-impact p-12 text-white lg:flex lg:flex-col">
        {/* The chip follows the theme: on a white chip the dark theme's light "Sisa" text would vanish. */}
        <Link
          href="/welcome"
          className="relative w-fit rounded-2xl bg-white/95 px-3 py-2 text-foreground outline-none focus-visible:ring-3 focus-visible:ring-white/60 dark:bg-background/90"
        >
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
        {/* lg+: the brand panel already shows the logo, so only the theme toggle stays here. */}
        <header className="safe-top mx-auto flex h-16 w-full max-w-md items-center justify-between gap-3 px-4 lg:max-w-[32rem]">
          <Link href="/welcome" aria-label="Kembali ke beranda Sisa-Saji" className="lg:hidden">
            <Logo />
          </Link>
          <ThemeToggle className="-mr-1.5 ml-auto" />
        </header>
        <main id="konten" className="safe-bottom mx-auto flex w-full max-w-md flex-1 flex-col px-4 pt-2 pb-10 lg:max-w-[32rem] lg:justify-center lg:pt-10">
          {children}
        </main>
      </div>
    </div>
  );
}
