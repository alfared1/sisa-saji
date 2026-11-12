"use client";

/**
 * Appearance controls (Terang / Gelap / Sistem) on top of next-themes.
 *
 *  - <ThemeSwitcher />: the full segmented control for settings screens
 *    (customer Akun, merchant Pengaturan). Applies on change, no save button.
 *  - <ThemeToggle />: a round icon button for headers that opens a small
 *    radio menu with the same three choices.
 *  - <ThemeColorSync />: mounted once in AppProviders; keeps the browser / PWA
 *    bar colour (<meta name="theme-color">) on the theme the page shows.
 *
 * Hydration: the stored choice lives in localStorage, so the server cannot
 * know it. Both controls render "no choice yet" on the server and during the
 * hydration pass (useSyncExternalStore, as in use-session.ts) and show the
 * real choice right after. The toggle's sun/moon icon needs no JS: it swaps
 * with the `dark:` variant, and next-themes sets `.dark` before first paint.
 */
import { useEffect, useId, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { MonitorSmartphoneIcon, MoonIcon, SunIcon, type LucideIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  THEME_OPTIONS,
  isResolvedTheme,
  isThemeChoice,
  themeColorFor,
  themeHint,
  type ThemeChoice,
  type ThemeIconName,
} from "@/lib/theme";
import { cn } from "@/lib/utils";

const THEME_ICONS: Record<ThemeIconName, LucideIcon> = {
  sun: SunIcon,
  moon: MoonIcon,
  device: MonitorSmartphoneIcon,
};

const noopSubscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

/** next-themes state, with `theme`/`resolvedTheme` undefined until hydration is over. */
function useThemeChoice(): {
  theme: ThemeChoice | undefined;
  resolvedTheme: string | undefined;
  setTheme: (theme: ThemeChoice) => void;
} {
  const hydrated = useSyncExternalStore(noopSubscribe, clientSnapshot, serverSnapshot);
  const { theme, resolvedTheme, setTheme } = useTheme();
  return {
    theme: hydrated && isThemeChoice(theme) ? theme : undefined,
    resolvedTheme: hydrated ? resolvedTheme : undefined,
    setTheme,
  };
}

/** Segmented radiogroup "Tema tampilan" with a helper line under it. */
export function ThemeSwitcher({ className }: { className?: string }) {
  const { theme, resolvedTheme, setTheme } = useThemeChoice();
  const name = useId();
  const hintId = useId();

  return (
    <div className={className}>
      <div
        role="radiogroup"
        aria-label="Tema tampilan"
        aria-describedby={hintId}
        className="grid grid-cols-3 gap-1 rounded-full bg-muted p-1 ring-1 ring-border/70 forced-colors:border"
      >
        {THEME_OPTIONS.map(({ value, label, icon }) => {
          const Icon = THEME_ICONS[icon];
          const checked = theme === value;
          return (
            <label key={value} className="relative min-w-0">
              {/* Same pattern as the tour's role switch: the transparent native radio covers its
                  option, so taps land on the radio itself and arrow keys move between options. */}
              <input
                type="radio"
                name={name}
                value={value}
                checked={checked}
                onChange={() => setTheme(value)}
                aria-label={label}
                className="peer absolute inset-0 z-10 cursor-pointer appearance-none rounded-full opacity-0"
              />
              <span
                aria-hidden
                className={cn(
                  "flex h-11 items-center justify-center gap-1.5 rounded-xl px-2 text-sm font-semibold transition-[background-color,color,transform] duration-150 peer-active:scale-[0.97]",
                  "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary",
                  // Forced colours (Windows High Contrast) drop backgrounds and shadows: the
                  // chosen option opts out and paints itself in the system Highlight pair.
                  checked
                    ? "bg-primary text-primary-foreground shadow-soft forced-color-adjust-none forced-colors:bg-[Highlight] forced-colors:text-[HighlightText]"
                    : "text-muted-foreground peer-hover:bg-card peer-hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{label}</span>
              </span>
            </label>
          );
        })}
      </div>
      {/* Empty (but one line tall) until the stored choice is known, so nothing jumps. */}
      <p id={hintId} className="mt-2 min-h-4 px-1 text-xs leading-4 text-muted-foreground">
        {themeHint(theme, resolvedTheme)}
      </p>
    </div>
  );
}

/** Round header button ("Ganti tema") that opens a Terang / Gelap / Sistem menu. */
export function ThemeToggle({
  className,
  align = "end",
}: {
  className?: string;
  align?: "start" | "center" | "end";
}) {
  const { theme, setTheme } = useThemeChoice();
  const labelId = useId();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* `title`: the icon alone does not say what it does to mouse users. Solid outline
            (not a box-shadow ring) like the switcher: readable on the cream gradient and kept
            in forced-colours mode. */}
        <button
          type="button"
          aria-label="Ganti tema"
          title="Ganti tema"
          className={cn(
            "inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-foreground/80 transition-colors",
            "hover:bg-muted hover:text-foreground active:bg-muted/70 aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/70",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
            className,
          )}
        >
          <SunIcon className="size-5 dark:hidden" aria-hidden />
          <MoonIcon className="hidden size-5 dark:block" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-44 rounded-xl p-1.5">
        <DropdownMenuLabel id={labelId} className="px-2 pt-1 pb-1.5">
          Tema tampilan
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          aria-labelledby={labelId}
          value={theme ?? ""}
          onValueChange={(value) => {
            if (isThemeChoice(value)) setTheme(value);
          }}
        >
          {THEME_OPTIONS.map(({ value, label, icon }) => {
            const Icon = THEME_ICONS[icon];
            return (
              <DropdownMenuRadioItem
                key={value}
                value={value}
                className="min-h-11 cursor-pointer gap-2.5 rounded-lg pl-2 text-sm font-semibold data-[state=checked]:text-primary"
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Points every <meta name="theme-color"> at the resolved theme. layout.tsx
 * ships a light/dark pair keyed on prefers-color-scheme (right for "Sistem");
 * a manual choice that differs from the OS needs the same colour in both.
 * Before hydration themeColorBootScript (src/lib/theme.ts) covers the first
 * paint; this effect runs after React has adopted the tags. The observer
 * re-applies the colour if Next re-renders the viewport tags (navigation).
 */
export function ThemeColorSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (!isResolvedTheme(resolvedTheme)) return;
    const color = themeColorFor(resolvedTheme);
    const apply = () => {
      for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
        if (meta.content !== color) meta.content = color;
      }
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ["content"] });
    return () => observer.disconnect();
  }, [resolvedTheme]);

  return null;
}
