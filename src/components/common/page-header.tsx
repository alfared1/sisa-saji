"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Sticky page header: back button + title (+ subtitle) + right-side actions.
 * Back goes to history when there is one, otherwise to `backHref`.
 *
 * On lg+ (customer desktop layout) it is an in-page title row under the
 * desktop nav: not sticky, no bar background, a larger title, and the back
 * button as a small outlined circle beside it.
 */
export function PageHeader({
  title,
  subtitle,
  backHref,
  onBack,
  showBack = true,
  actions,
  sticky = true,
  transparent = false,
  className,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  backHref?: string;
  onBack?: () => void;
  showBack?: boolean;
  actions?: ReactNode;
  sticky?: boolean;
  transparent?: boolean;
  className?: string;
  /** Extra row below the title (tabs, search…). */
  children?: ReactNode;
}) {
  const router = useRouter();

  const handleBack = () => {
    if (onBack) return onBack();
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push(backHref ?? "/");
  };

  return (
    <header
      className={cn(
        "safe-top z-30",
        sticky && "sticky top-0",
        transparent ? "bg-transparent" : "border-b border-border/60 bg-background/85 backdrop-blur-xl",
        "lg:static lg:z-auto lg:border-b-0 lg:bg-transparent lg:backdrop-blur-none",
        className,
      )}
    >
      <div className="flex min-h-14 items-center gap-1 px-2 lg:gap-3 lg:px-4 lg:pt-6 lg:pb-2">
        {showBack ? (
          <Button
            variant="ghost"
            size="icon-lg"
            className="size-10 rounded-full lg:size-9 lg:bg-card lg:ring-1 lg:ring-border lg:hover:bg-muted"
            onClick={handleBack}
            aria-label="Kembali"
          >
            <ChevronLeftIcon className="size-5" />
          </Button>
        ) : (
          <span className="w-2 lg:hidden" />
        )}
        <div className="min-w-0 flex-1 py-2">
          <h1 className="truncate text-base font-bold leading-tight lg:text-2xl lg:font-extrabold">{title}</h1>
          {subtitle && <p className="truncate text-xs text-muted-foreground lg:mt-0.5 lg:text-sm">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1 pr-1">{actions}</div>}
      </div>
      {children && <div className="px-4 pb-3">{children}</div>}
    </header>
  );
}
