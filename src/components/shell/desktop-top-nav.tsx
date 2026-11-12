"use client";

/**
 * Customer top navigation for laptops/desktops (lg+, ≥1024px). Rendered with
 * `hidden lg:block`, so phones (and Playwright's Pixel 7 run) never see it;
 * phones keep the bottom tab bar + FloatingCartBar from CustomerShell.
 */
import Link from "next/link";
import { useShallow } from "zustand/react/shallow";
import { ShoppingBagIcon } from "lucide-react";
import { Logo } from "@/components/common/logo";
import { LocationPill } from "@/components/common/location-pill";
import { ThemeToggle } from "@/components/common/theme-switcher";
import { useSession } from "@/hooks/use-session";
import { formatIdr } from "@/lib/time";
import { cn } from "@/lib/utils";
import { selectCartCount, selectCartSubtotal, useCartStore } from "@/stores/cart";
import { useStoresHydrated } from "@/stores/hydration";
import { useTicketsStore } from "@/stores/tickets";
import type { ShellTab } from "./customer-shell";
import { activeCustomerHref, loginHrefFor, showsDesktopCartButton, showsDesktopLoginButton } from "./nav-logic";

/** Same max width as the customer content container (see customer-shell.tsx). */
export const DESKTOP_CONTENT_MAX_W = "max-w-[1280px]";

export function DesktopTopNav({ pathname, tabs }: { pathname: string; tabs: readonly ShellTab[] }) {
  const hydrated = useStoresHydrated();
  const ticketCount = useTicketsStore((s) => Object.keys(s.tickets).length);
  const active = activeCustomerHref(pathname);

  return (
    <header className="sticky top-0 z-40 hidden border-b border-border/60 bg-background/85 backdrop-blur-xl lg:block">
      <div className={cn("mx-auto flex h-16 w-full items-center gap-4 px-8", DESKTOP_CONTENT_MAX_W)}>
        <Link
          href="/discover"
          aria-label="Sisa-Saji, ke Beranda"
          className="shrink-0 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Logo markClassName="size-8" />
        </Link>

        <nav aria-label="Navigasi utama" className="shrink-0">
          <ul className="flex items-center gap-0.5">
            {tabs.map(({ href, label, icon: Icon }) => {
              const isActive = active === href;
              const badge = href === "/orders" && hydrated && ticketCount > 0 ? ticketCount : 0;
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "relative inline-flex h-10 items-center gap-2 rounded-full px-2.5 text-sm font-semibold outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 xl:px-3",
                      isActive
                        ? "bg-brand-soft text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <Icon className={cn("hidden size-4 xl:block", isActive && "stroke-[2.4]")} aria-hidden />
                    {label}
                    {badge > 0 && (
                      <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-deal px-1 text-[11px] leading-5 font-extrabold text-deal-foreground tabular-nums">
                        {badge}
                        <span className="sr-only"> tiket tersimpan</span>
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* A guest with a cart fills the row (location, cart, "Masuk", toggle): the tight gaps, the
            xl:px-3 tabs and the icon-less "Masuk" below xl keep the location label untruncated. */}
        <div className="ml-auto flex min-w-0 items-center gap-2 xl:gap-2.5">
          <LocationPill variant="compact" className="max-w-80" />
          <DesktopCartButton pathname={pathname} />
          <DesktopLoginButton pathname={pathname} />
          {/* Always rightmost: the cart and (for guests, once the session check is done) "Masuk"
              appear to its left, so the toggle never moves under the pointer. */}
          <ThemeToggle className="size-10 max-xl:size-9" />
        </div>
      </div>
    </header>
  );
}

function DesktopCartButton({ pathname }: { pathname: string }) {
  const hydrated = useStoresHydrated();
  const { count, subtotal } = useCartStore(
    useShallow((s) => ({ count: selectCartCount(s), subtotal: selectCartSubtotal(s) })),
  );
  if (!showsDesktopCartButton({ pathname, hydrated, count })) return null;

  return (
    <Link
      href="/checkout"
      aria-label={`Keranjang: ${count} item, total ${formatIdr(subtotal)}. Lanjut ke checkout`}
      className="animate-float-up inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-primary pr-4 pl-1.5 text-sm font-semibold text-primary-foreground shadow-soft outline-none transition-colors hover:bg-brand-strong max-xl:pr-1.5 focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span className="relative inline-flex size-7 items-center justify-center rounded-full bg-white/15">
        <ShoppingBagIcon className="size-4" aria-hidden />
        <span className="absolute -top-1.5 -right-1.5 inline-flex min-w-4.5 items-center justify-center rounded-full bg-deal px-1 text-[10px] leading-4.5 font-extrabold text-deal-foreground tabular-nums ring-2 ring-primary">
          {count}
        </span>
      </span>
      {/* 1024–1279px: the total lives only in the aria-label so the bar fits. */}
      <span className="hidden tabular-nums xl:inline">{formatIdr(subtotal)}</span>
    </Link>
  );
}

function DesktopLoginButton({ pathname }: { pathname: string }) {
  // `hydrated` is false for the hydration render, so the server HTML (no
  // session yet) and the first client render agree even when /auth/me is
  // already cached by the time this Suspense boundary hydrates.
  const hydrated = useStoresHydrated();
  const session = useSession();
  if (!showsDesktopLoginButton({ hydrated, isLoading: session.isLoading, loggedIn: session.isLoggedIn })) return null;
  return (
    <Link
      href={loginHrefFor(pathname)}
      className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-foreground px-4 text-sm font-semibold text-background outline-none transition-opacity hover:opacity-90 focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      Masuk
    </Link>
  );
}
