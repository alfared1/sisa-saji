"use client";

import Link from "next/link";
import { useShallow } from "zustand/react/shallow";
import { ChevronRightIcon, ShoppingBagIcon } from "lucide-react";
import { formatIdr } from "@/lib/time";
import { cn } from "@/lib/utils";
import {
  selectCartCount,
  selectCartSavings,
  selectCartSubtotal,
  useCartStore,
} from "@/stores/cart";
import { useStoresHydrated } from "@/stores/hydration";

/** Floating summary of the cart → /checkout. Hidden when empty. */
export function FloatingCartBar({ className, href = "/checkout" }: { className?: string; href?: string }) {
  const hydrated = useStoresHydrated();
  const { count, subtotal, savings, merchantName } = useCartStore(
    useShallow((s) => ({
      count: selectCartCount(s),
      subtotal: selectCartSubtotal(s),
      savings: selectCartSavings(s),
      merchantName: s.merchant?.name ?? "",
    })),
  );

  if (!hydrated || count === 0) return null;

  return (
    <Link
      href={href}
      className={cn(
        "animate-float-up flex items-center gap-3 rounded-2xl bg-primary p-2 pr-3 text-primary-foreground shadow-float outline-none transition-transform active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
      aria-label={`Keranjang: ${count} item, total ${formatIdr(subtotal)}. Lanjut ke checkout`}
    >
      <span className="relative inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-white/15">
        <ShoppingBagIcon className="size-5" />
        <span className="absolute -top-1 -right-1 inline-flex min-w-5 items-center justify-center rounded-full bg-deal px-1 text-[11px] font-extrabold text-deal-foreground tabular-nums ring-2 ring-primary">
          {count}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs text-primary-foreground/80">{merchantName}</span>
        <span className="flex items-baseline gap-2">
          <span className="text-base font-extrabold tabular-nums">{formatIdr(subtotal)}</span>
          {savings > 0 && (
            <span className="truncate text-xs font-semibold text-primary-foreground/85 tabular-nums">
              Hemat {formatIdr(savings)}
            </span>
          )}
        </span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-0.5 text-sm font-semibold">
        Checkout <ChevronRightIcon className="size-4" />
      </span>
    </Link>
  );
}
