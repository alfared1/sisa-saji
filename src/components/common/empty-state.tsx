import type { ComponentType, ReactNode } from "react";
import { SoupIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon = SoupIcon,
  title,
  description,
  action,
  className,
}: {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-3 px-6 py-12 text-center", className)}>
      <div className="relative">
        <span className="relative inline-flex size-16 items-center justify-center rounded-3xl bg-card text-primary shadow-card ring-1 ring-border">
          <Icon className="size-7" />
        </span>
      </div>
      <h3 className="mt-2 text-base font-semibold">{title}</h3>
      {description && <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
