"use client";

import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import { MinusIcon, PlusIcon, StarIcon } from "lucide-react";
import { LogoMark } from "@/components/common/logo";
import { Button } from "@/components/ui/button";
import type { OrderStatus } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { STATUS_META, type StatusTone } from "./lib/order-status";

/* ------------------------------ Section header ------------------------------ */

export function SectionHeader({
  title,
  subtitle,
  icon: Icon,
  iconClassName,
  action,
  className,
  id,
}: {
  title: string;
  subtitle?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  iconClassName?: string;
  action?: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div className={cn("flex items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 id={id} className="flex items-center gap-1.5 text-base font-semibold">
          {Icon && <Icon className={cn("size-4.5 shrink-0", iconClassName)} />}
          <span className="truncate">{title}</span>
        </h2>
        {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/* -------------------------------- Stepper -------------------------------- */

export function QtyStepper({
  value,
  min = 0,
  max,
  onChange,
  label,
  size = "md",
  className,
}: {
  value: number;
  min?: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const btn = size === "sm" ? "size-9" : "size-11";
  return (
    <div
      className={cn("inline-flex items-center rounded-full bg-card p-0.5 shadow-soft ring-1 ring-border", className)}
      role="group"
      aria-label={`Jumlah ${label}`}
    >
      <button
        type="button"
        className={cn(
          btn,
          "inline-flex items-center justify-center rounded-full text-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-95 disabled:opacity-40",
        )}
        onClick={() => onChange(value - 1)}
        disabled={value <= min}
        aria-label={value <= 1 ? `Hapus ${label}` : `Kurangi ${label}`}
      >
        <MinusIcon className="size-4" />
      </button>
      <span className="min-w-7 text-center text-sm font-extrabold tabular-nums" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className={cn(
          btn,
          "inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-95 disabled:bg-muted disabled:text-muted-foreground",
        )}
        onClick={() => onChange(value + 1)}
        disabled={value >= max}
        aria-label={`Tambah ${label}`}
      >
        <PlusIcon className="size-4" />
      </button>
    </div>
  );
}

/* --------------------------------- Rating --------------------------------- */

export function RatingStars({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-label={`Rating ${value} dari 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <StarIcon
          key={i}
          className={cn(
            "size-3.5",
            i <= Math.round(value) ? "fill-amber-400 text-amber-400" : "fill-muted text-muted-foreground/30",
          )}
          aria-hidden
        />
      ))}
    </span>
  );
}

/* ------------------------------- Status chip ------------------------------- */

const TONE_CLASS: Record<StatusTone, string> = {
  deal: "bg-deal-soft text-deal",
  brand: "bg-brand-soft text-primary",
  success: "bg-success-soft text-primary",
  muted: "bg-muted text-muted-foreground",
  urgent: "bg-urgent-soft text-urgent",
};

export function OrderStatusChip({ status, className }: { status: OrderStatus; className?: string }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] leading-none font-semibold",
        TONE_CLASS[meta.tone],
        className,
      )}
    >
      <span
        className="size-1.5 rounded-full bg-current"
        aria-hidden
      />
      {meta.label}
    </span>
  );
}

/* -------------------------------- Login CTA -------------------------------- */

export function LoginCta({
  title,
  description,
  next,
  className,
  icon,
}: {
  title: string;
  description: string;
  next: string;
  className?: string;
  icon?: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      <div className="relative">
        <span className="relative inline-flex size-20 items-center justify-center rounded-3xl bg-card shadow-card ring-1 ring-border">
          {icon ?? <LogoMark className="size-12" />}
        </span>
      </div>
      <h2 className="mt-6 text-xl font-bold">{title}</h2>
      <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">{description}</p>
      <Button asChild className="mt-6 h-12 rounded-xl px-7 text-base font-semibold shadow-card">
        <Link href={`/auth/login?next=${encodeURIComponent(next)}`}>
          Masuk / Daftar
        </Link>
      </Button>
      <p className="mt-3 text-xs text-muted-foreground">Cukup nomor WhatsApp atau email, tanpa kata sandi.</p>
    </div>
  );
}

/* --------------------------- Page title (tab root) --------------------------- */

export function TabTitle({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-bold">{title}</h1>
        {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
