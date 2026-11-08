import { LogoMark } from "@/components/common/logo";
import { cn } from "@/lib/utils";

/** Full-screen branded loading state (redirect gates, session checks). */
export function AppSplash({ label = "Memuat…", className }: { label?: string; className?: string }) {
  return (
    <div
      className={cn("app-backdrop flex min-h-dvh flex-col items-center justify-center gap-4 px-6", className)}
      aria-busy="true"
      aria-live="polite"
    >
      <LogoMark className="size-16 animate-soft-pulse drop-shadow-lg" />
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
    </div>
  );
}
