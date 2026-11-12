import Link from "next/link";
import { LeafIcon, QrCodeIcon, TimerIcon } from "lucide-react";
import { Logo } from "@/components/common/logo";
import { ThemeToggle } from "@/components/common/theme-switcher";
import { EVENING_EXAMPLE, EVENING_TIMELINE } from "@/lib/pricing/evening-example";
import { formatIdr } from "@/lib/time";
import { cn } from "@/lib/utils";

/**
 * The product's one idea, shown instead of told: the same menu priced by the real optimizer
 * at three points of the evening. Labelled "Contoh" because it is not live data.
 */
function PriceDropExample() {
  return (
    <section aria-labelledby="contoh-harga" className="rounded-3xl bg-card p-5 text-card-foreground shadow-card">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="contoh-harga" className="min-w-0 truncate text-base font-bold">
          {EVENING_EXAMPLE.name}
        </h3>
        <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">Contoh</span>
      </div>
      <p className="mt-0.5 text-sm text-muted-foreground">
        Harga normal <span className="tabular-nums line-through">{formatIdr(EVENING_EXAMPLE.priceIdr)}</span>
      </p>
      <ol className="mt-3">
        {EVENING_TIMELINE.map((step) => (
          <li key={step.when} className="flex items-baseline justify-between gap-4 border-t border-border py-2.5 first:border-t-0">
            <span className={cn("text-sm font-semibold", step.flash && "text-flash dark:text-flash-accent")}>
              {step.flash ? `${step.when}, Diskon Kilat` : step.when}
            </span>
            <span className="shrink-0 tabular-nums">
              <b className="text-lg font-extrabold">{formatIdr(step.quote.recommendedSellingPriceIdr)}</b>
              <span className="ml-1.5 text-sm font-bold text-deal">−{step.quote.recommendedDiscountPct}%</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

const POINTS = [
  { icon: TimerIcon, text: "Diskon naik sendiri mendekati jam tutup warung." },
  { icon: QrCodeIcon, text: "Ambil sendiri di warung dengan tiket QR, tanpa ongkir." },
  { icon: LeafIcon, text: "Setiap porsi yang kamu ambil tercatat sebagai dampakmu." },
] as const;

/** Auth frame: brand panel on desktop, focused single column on mobile. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-backdrop min-h-dvh lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(30rem,1fr)]">
      {/* One centred stack (logo, message, example, points), level with the form card, so no screen size leaves a gap in the middle. Short laptop screens get a tighter stack without the points. */}
      <aside className="hidden bg-impact text-white lg:flex lg:flex-col lg:justify-center lg:px-12 lg:py-10 xl:px-16">
        <div className="mx-auto w-full max-w-lg">
          <Link
            href="/welcome"
            aria-label="Beranda Sisa-Saji"
            className="inline-flex w-fit rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-white/60"
          >
            <Logo tone="onImpact" />
          </Link>

          <h2 className="mt-10 text-4xl leading-tight font-extrabold xl:text-[2.75rem] [@media(max-height:760px)]:mt-6 [@media(max-height:760px)]:text-3xl">Porsi terakhir malam ini menunggu untuk diselamatkan.</h2>
          <p className="mt-3 max-w-md text-base leading-relaxed text-white/85">
            Warung di sekitarmu menjual porsi yang belum laku menjelang tutup. Makin dekat jam tutup, makin murah.
          </p>
          <div className="mt-8 [@media(max-height:760px)]:mt-5">
            <PriceDropExample />
          </div>

          <ul className="mt-8 space-y-2.5 text-sm text-white/85 [@media(max-height:760px)]:hidden">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <Icon className="size-5 shrink-0" aria-hidden /> {text}
              </li>
            ))}
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
        <main id="konten" className="safe-bottom mx-auto flex w-full max-w-md flex-1 flex-col px-4 pt-2 pb-10 lg:max-w-[32rem] lg:justify-center lg:pt-6">
          {children}
        </main>
      </div>
    </div>
  );
}
