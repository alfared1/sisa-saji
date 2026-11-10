"use client";

/**
 * Small building blocks shared by the merchant screens: page frame & header,
 * section cards, stepper, money input, model badge.
 */
import { useId, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import { ChevronLeftIcon, CpuIcon, MinusIcon, PlusIcon, SparklesIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { clampInt, modelLabel, parseIntLoose } from "./lib/logic";

export function MerchantPage({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("px-4 pt-4 pb-8 sm:px-6 lg:px-8 lg:pt-8", className)}>{children}</div>;
}

export function MerchantPageHeader({
  title,
  subtitle,
  actions,
  backHref,
  eyebrow,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  backHref?: string;
  eyebrow?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3", className)}>
      <div className="flex min-w-0 items-start gap-2">
        {backHref && (
          <Link
            href={backHref}
            aria-label="Kembali"
            className="-ml-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ChevronLeftIcon className="size-5" />
          </Link>
        )}
        <div className="min-w-0">
          {eyebrow && <div className="mb-1 text-xs font-semibold text-muted-foreground">{eyebrow}</div>}
          <h1 className="text-[1.6rem] leading-tight font-extrabold tracking-tight lg:text-3xl">{title}</h1>
          {subtitle && <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionCard({
  title,
  icon: Icon,
  description,
  action,
  children,
  className,
  bodyClassName,
  id,
}: {
  title?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  const headingId = useId();
  return (
    <section
      id={id}
      aria-labelledby={title ? headingId : undefined}
      className={cn("rounded-3xl bg-card shadow-soft ring-1 ring-border", className)}
    >
      {title && (
        <header className="flex items-start justify-between gap-3 px-4 pt-5 sm:px-5 sm:pt-6">
          <div className="flex min-w-0 items-start gap-2.5">
            {Icon && (
              // -my-1.5 centres the 32 px icon on the 20 px title line (also for 2-line titles + descriptions).
              <span className="-my-1.5 inline-flex size-8 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-primary">
                <Icon className="size-4" />
              </span>
            )}
            <div className="min-w-0">
              <h2 id={headingId} className="text-base leading-tight font-bold">
                {title}
              </h2>
              {description && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>}
            </div>
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={cn("p-4 sm:p-5", title && "pt-3 sm:pt-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/** "LightGBM" / "Heuristik" model chip. */
export function ModelBadge({ version, className, tone = "default" }: { version: string; className?: string; tone?: "default" | "onDark" }) {
  const label = modelLabel(version);
  const Icon = label === "LightGBM" ? CpuIcon : SparklesIcon;
  return (
    <span
      title={`Model: ${version}`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] leading-none font-bold",
        tone === "onDark" ? "bg-white/15 text-white ring-1 ring-white/20" : label === "LightGBM" ? "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300" : "bg-muted text-foreground/75",
        className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {label}
    </span>
  );
}

/** Large +/- stepper with a typeable centre value. */
export function Stepper({
  value,
  onChange,
  min = 1,
  max = 500,
  step = 1,
  label,
  unit,
  size = "lg",
  disabled,
  id,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  unit?: string;
  size?: "md" | "lg";
  disabled?: boolean;
  id?: string;
}) {
  const big = size === "lg";
  const btn = cn(
    "inline-flex shrink-0 items-center justify-center rounded-2xl bg-card text-foreground ring-1 ring-border transition-all outline-none select-none hover:bg-muted active:scale-95 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40",
    big ? "size-14" : "size-11",
  );
  return (
    <div className="flex items-center gap-3" role="group" aria-label={label}>
      <button type="button" className={btn} aria-label={`Kurangi ${label}`} disabled={disabled || value <= min} onClick={() => onChange(clampInt(value - step, min, max))}>
        <MinusIcon className={big ? "size-6" : "size-5"} />
      </button>
      <div className="flex min-w-0 flex-1 flex-col items-center">
        <input
          id={id}
          inputMode="numeric"
          pattern="[0-9]*"
          aria-label={label}
          disabled={disabled}
          value={String(value)}
          onChange={(e) => {
            const n = parseIntLoose(e.target.value);
            onChange(n === null ? min : clampInt(n, min, max));
          }}
          onFocus={(e) => e.currentTarget.select()}
          className={cn(
            "w-full min-w-0 rounded-xl bg-transparent text-center font-extrabold tabular-nums outline-none focus-visible:bg-muted",
            big ? "text-5xl leading-none" : "text-2xl",
          )}
        />
        {unit && <span className="mt-1 text-xs font-semibold text-muted-foreground">{unit}</span>}
      </div>
      <button type="button" className={cn(btn, "bg-primary text-primary-foreground ring-primary hover:bg-primary/90")} aria-label={`Tambah ${label}`} disabled={disabled || value >= max} onClick={() => onChange(clampInt(value + step, min, max))}>
        <PlusIcon className={big ? "size-6" : "size-5"} />
      </button>
    </div>
  );
}

/** Rupiah input: shows "12.000" with an "Rp" prefix, emits integers (or null when empty). */
export function MoneyInput({
  value,
  onChange,
  id,
  invalid,
  describedBy,
  placeholder = "0",
  className,
  onBlur,
}: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  id?: string;
  invalid?: boolean;
  describedBy?: string;
  placeholder?: string;
  className?: string;
  onBlur?: () => void;
}) {
  const shown = value === null || value === undefined || Number.isNaN(value) ? "" : value.toLocaleString("id-ID");
  return (
    <div className={cn("relative", className)}>
      <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-sm font-semibold text-muted-foreground">Rp</span>
      <Input
        id={id}
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        value={shown}
        onBlur={onBlur}
        onChange={(e) => onChange(parseIntLoose(e.target.value))}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className="h-12 rounded-2xl bg-card pl-11 text-base font-semibold tabular-nums"
      />
    </div>
  );
}

export function FieldError({ id, children }: { id?: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="text-xs font-medium text-destructive">
      {children}
    </p>
  );
}

export function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  tint = "brand",
  className,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tint?: "brand" | "deal" | "sky" | "amber" | "urgent";
  className?: string;
}) {
  const tints = {
    brand: "bg-brand-soft text-primary",
    deal: "bg-deal-soft text-deal",
    sky: "bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
    amber: "bg-warning-soft text-amber-700 dark:text-amber-300",
    urgent: "bg-urgent-soft text-urgent",
  } as const;
  return (
    <div className={cn("flex min-w-0 flex-col gap-2 rounded-2xl bg-card p-3.5 ring-1 ring-border sm:p-4", className)}>
      <div className="flex items-center gap-2">
        <span className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-xl", tints[tint])}>
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 text-xs leading-tight font-semibold text-balance text-muted-foreground">{label}</span>
      </div>
      <div className="truncate text-xl leading-none font-extrabold tabular-nums sm:text-2xl">{value}</div>
      {hint && <div className="text-xs leading-snug text-muted-foreground">{hint}</div>}
    </div>
  );
}
