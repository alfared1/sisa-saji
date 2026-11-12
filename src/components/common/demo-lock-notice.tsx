import { LockIcon } from "lucide-react";
import { DEMO_LOCKED_NOTICE } from "@/lib/demo-accounts";
import { cn } from "@/lib/utils";

/**
 * Shown above forms that the shared demo accounts cannot change (the API refuses them with
 * 403 DEMO_LOCKED). Yellow like every other demo label. `hint` says what still works;
 * `message` replaces the general notice for a single locked feature.
 */
export function DemoLockNotice({ hint, message, className }: { hint?: string; message?: string; className?: string }) {
  return (
    <p
      role="note"
      className={cn(
        "flex items-start gap-2 rounded-2xl bg-warning-soft px-3.5 py-3 text-xs leading-relaxed text-amber-900 dark:text-amber-100",
        className,
      )}
    >
      <LockIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        {message ?? DEMO_LOCKED_NOTICE}
        {hint && <> {hint}</>}
      </span>
    </p>
  );
}
