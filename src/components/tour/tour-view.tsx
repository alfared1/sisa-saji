"use client";

/**
 * /tour: product walkthrough with two tracks (Pembeli, Mitra Warung), five
 * steps each. Built as an accessible carousel: role="region" +
 * aria-roledescription="carousel", one role="group" slide at a time, a polite
 * live counter, focus moved to the new slide's h2 on every step change.
 * Navigation: Lanjut/Kembali, dots, ArrowLeft/ArrowRight, and swipe/drag.
 *
 * ?peran=mitra opens the merchant track, ?langkah=N deep-links a step. Both
 * are read on every visit, including a return to a route Next kept alive, so
 * a reopened tour never resumes where the last visit stopped. The track stays
 * in the URL via router.replace.
 * Reaching the last step, skipping, or any final CTA calls markTourSeen(),
 * which "/" reads; only opening a deep link to the last step does not.
 */
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, MotionConfig, motion, useIsPresent, useReducedMotion, type PanInfo, type Variants } from "motion/react";
import { ArrowLeftIcon, ArrowRightIcon, ShoppingBagIcon, StoreIcon } from "lucide-react";
import { Logo } from "@/components/common/logo";
import { ThemeToggle } from "@/components/common/theme-switcher";
import { Button } from "@/components/ui/button";
import { SESSION_QUERY_KEY, useSession } from "@/hooks/use-session";
import type { AuthMeResponse } from "@/lib/contracts";
import { markTourSeen } from "@/lib/pwa/visitor";
import { cn } from "@/lib/utils";
import { PhoneFrame } from "./phone-frame";
import {
  TOUR_ROLES,
  TOUR_ROLE_LABELS,
  arrowKeyIntent,
  clampStep,
  dotAriaLabel,
  isLastStep,
  parseRole,
  parseStepParam,
  skipTarget,
  slideAriaLabel,
  stepCounterLabel,
  swipeIntent,
  targetOwnsArrowKeys,
  tourHref,
  type TourRole,
} from "./tour-logic";
import { TOUR_MOCKS } from "./tour-mocks";
import { TOUR_STEPS, type TourStep } from "./tour-steps";

type Direction = 1 | -1;

/**
 * Slide in from the side we are heading to, leave towards the other. Under
 * prefers-reduced-motion only the fade is left: MotionConfig would merely skip
 * the x tween, so the outgoing slide would still jump 44 px before fading.
 */
type SlideCustom = { d: Direction; reduce: boolean };
const SLIDE: Variants = {
  enter: ({ d, reduce }: SlideCustom) => ({ opacity: 0, x: reduce ? 0 : d * 44 }),
  center: { opacity: 1, x: 0 },
  exit: ({ d, reduce }: SlideCustom) => ({ opacity: 0, x: reduce ? 0 : d * -44 }),
};

/** Variant input for SLIDE. Only read while animating (initial={false}), so it never affects the SSR markup. */
function useSlideCustom(d: Direction): SlideCustom {
  return { d, reduce: useReducedMotion() ?? false };
}
const SLIDE_TRANSITION = {
  x: { type: "spring" as const, stiffness: 420, damping: 38 },
  opacity: { duration: 0.2 },
};

/** Primary pill used by every bottom-bar action (48 px tall: comfortable thumb target). */
const ACTION = "h-12 cursor-pointer rounded-full px-5 text-base font-bold";

/** Secondary actions on the last step: underlined text with a 44 px hit area. */
const TEXT_ACTION =
  "inline-flex h-11 cursor-pointer items-center rounded-lg px-1.5 font-bold text-brand-strong underline decoration-brand-strong/40 underline-offset-4 outline-none hover:decoration-brand-strong focus-visible:ring-3 focus-visible:ring-ring/50";

const HINT_ID = "tur-petunjuk";

export function TourView() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { user, isMerchant, isLoading: sessionLoading } = useSession();

  const peranParam = params.get("peran");
  const langkahParam = params.get("langkah");
  const [role, setRole] = useState<TourRole>(() => parseRole(peranParam));
  const [step, setStep] = useState(() => parseStepParam(langkahParam, TOUR_STEPS[parseRole(peranParam)].length));
  const [direction, setDirection] = useState<Direction>(1);
  /** Set by the action that changes the slide: whether focus should follow to the new h2. */
  const focusNext = useRef(false);
  const slideCustom = useSlideCustom(direction);

  // Every visit starts from the link that opened it (step 1, or ?peran / ?langkah). Next keeps a
  // visited route alive (React Activity) and re-runs its effects when the route is shown again, so
  // this mount-only layout effect runs on each return too, before the old step is painted. It does
  // not depend on the params: the tour's own router.replace (switchRole) must not reset a step the
  // user has already moved on to while that navigation was in flight.
  const startFromUrl = useEffectEvent(() => {
    const fromUrl = parseRole(peranParam);
    setRole(fromUrl);
    setStep(parseStepParam(langkahParam, TOUR_STEPS[fromUrl].length));
    setDirection(1);
  });
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a reset per visit; nothing at render time tells a return from a stay
    startFromUrl();
  }, []);

  const steps = TOUR_STEPS[role];
  const total = steps.length;
  const current = steps[step];
  const last = isLastStep(step, total);
  const slideKey = `${role}-${step}`;
  const titleId = `tur-judul-${slideKey}`;

  const goTo = useCallback(
    (target: number, focus = true) => {
      const to = clampStep(target, total);
      if (to === step) return;
      setDirection(to > step ? 1 : -1);
      setStep(to);
      focusNext.current = focus;
      // Walking onto the last step counts as having finished the tour (a deep link to it does not).
      if (isLastStep(to, total)) markTourSeen();
    },
    [step, total],
  );

  const move = useCallback((delta: -1 | 1) => goTo(step + delta), [goTo, step]);

  const switchRole = useCallback(
    (next: TourRole, focus: boolean) => {
      if (next === role) return;
      setDirection(1);
      setRole(next);
      setStep(0);
      focusNext.current = focus;
      router.replace(tourHref(next), { scroll: false });
    },
    [role, router],
  );

  // Focus follows the slide (its h2 is tabIndex -1), and on phones the stage
  // above the title scrolls back into view.
  useEffect(() => {
    if (!focusNext.current) return;
    focusNext.current = false;
    document.getElementById(titleId)?.focus({ preventScroll: true });
    if (window.scrollY > 0) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    }
  }, [titleId]);

  // Arrow keys also work before anything has focus (focus on <body>), e.g. right after the page opens.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const active = document.activeElement;
      if (active && active !== document.body) return;
      const intent = arrowKeyIntent(e);
      if (!intent) return;
      e.preventDefault();
      move(intent);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move]);

  const onRegionKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const intent = arrowKeyIntent(e);
    if (!intent) return;
    const t = e.target as HTMLElement;
    const owns = targetOwnsArrowKeys({
      tagName: t.tagName,
      isContentEditable: t.isContentEditable,
      role: t.getAttribute("role"),
      ancestorRole: t.parentElement?.closest("[role]")?.getAttribute("role"),
    });
    if (owns) return;
    e.preventDefault();
    move(intent);
  };

  const onSwipe = (info: PanInfo) => {
    const intent = swipeIntent({ offsetX: info.offset.x, offsetY: info.offset.y, velocityX: info.velocity.x });
    if (intent) move(intent);
  };

  const skip = () => {
    markTourSeen();
    const cached = qc.getQueryData<AuthMeResponse>(SESSION_QUERY_KEY);
    // Session not answered yet: "/" waits for it and routes signed-in users by role, guests to /welcome.
    const loggedIn = user || cached?.user ? true : sessionLoading && !cached ? null : false;
    router.push(skipTarget(loggedIn));
  };

  const otherRole: TourRole = role === "pembeli" ? "mitra" : "pembeli";
  // Shown once the session is known, so a signed-in user never sees it flash.
  const showLogin = role === "pembeli" && !sessionLoading && !user;

  const finalCta =
    role === "pembeli" ? (
      <Button asChild className={cn(ACTION, "flex-1 md:flex-none")}>
        <Link href="/discover" onClick={markTourSeen}>
          <ShoppingBagIcon />
          Mulai cari makanan
        </Link>
      </Button>
    ) : isMerchant ? (
      <Button asChild className={cn(ACTION, "flex-1 md:flex-none")}>
        <Link href="/merchant/dashboard" onClick={markTourSeen}>
          <StoreIcon />
          Buka dasbor mitra
        </Link>
      </Button>
    ) : (
      <Button asChild className={cn(ACTION, "flex-1 md:flex-none")}>
        {/* Same target as the profile's "Daftar jadi mitra": a signed-in customer goes straight to onboarding. */}
        <Link href={user ? "/merchant/onboarding" : "/auth/login?role=MERCHANT"} onClick={markTourSeen}>
          <StoreIcon />
          Daftar jadi mitra
        </Link>
      </Button>
    );

  // One compact row under the CTA: sign in (guests, pembeli track) and the switch to the other track.
  const finalLinks = (
    <p className="mt-1 flex flex-wrap items-center justify-center gap-x-1 text-sm text-muted-foreground md:mt-2 md:justify-start md:text-base">
      {showLogin && (
        <>
          <Link href="/auth/login" onClick={markTourSeen} className={TEXT_ACTION}>
            Masuk atau daftar
          </Link>
          <span aria-hidden className="px-0.5 text-muted-foreground/70">
            ·
          </span>
        </>
      )}
      {/* The lead-in only where the row has room for it next to "Masuk atau daftar". */}
      <span className={cn("pl-1.5", showLogin && "max-lg:hidden")}>
        {role === "pembeli" ? "Punya warung?" : "Mau cari makan hemat?"}
      </span>
      <button type="button" onClick={() => switchRole(otherRole, true)} className={TEXT_ACTION}>
        {role === "pembeli" ? "Saya pemilik warung" : "Saya pembeli"}
      </button>
    </p>
  );

  return (
    <MotionConfig reducedMotion="user">
      <div className="app-backdrop flex min-h-dvh flex-col">
        <header className="safe-top mx-auto w-full max-w-md px-4 md:max-w-5xl md:px-8 lg:max-w-6xl">
          <div className="flex h-14 items-center justify-between gap-3 md:h-16">
            <Logo />
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <Button
                type="button"
                variant="ghost"
                onClick={skip}
                className="h-11 cursor-pointer rounded-full px-4 text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Lewati tur
              </Button>
            </div>
          </div>
        </header>

        {/* overflow-x-clip (not hidden): clips the sideways slide travel without breaking the sticky bar. */}
        <main id="konten" className="mx-auto flex w-full max-w-md flex-1 flex-col overflow-x-clip px-4 md:max-w-5xl md:px-8 lg:max-w-6xl">
          <h1 className="sr-only">Tur aplikasi Sisa-Saji</h1>
          <p id={HINT_ID} className="sr-only">
            Tekan panah kiri atau kanan untuk berpindah langkah.
          </p>
          <div
            role="region"
            aria-roledescription="carousel"
            aria-label="Tur Sisa-Saji"
            aria-describedby={HINT_ID}
            onKeyDown={onRegionKeyDown}
            // md+: two columns, both centred in the viewport (the 1fr rows above and below take the slack).
            className="flex flex-1 flex-col md:grid md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:grid-rows-[1fr_auto_auto_auto_1fr] md:gap-x-10 md:py-8 lg:gap-x-16 lg:pt-2 lg:pb-8"
          >
            <RoleSwitch role={role} onChange={(r) => switchRole(r, false)} className="md:col-start-1 md:row-start-2" />

            <Stage
              slideKey={slideKey}
              step={current}
              direction={direction}
              onSwipe={onSwipe}
              className="mt-3 md:col-start-2 md:row-span-5 md:row-start-1 md:mt-0 md:self-center"
            />

            {/* md+: a fixed minimum height (the longest step), so the role switch and the controls do not jump between steps. */}
            <div className="mt-4 md:col-start-1 md:row-start-3 md:mt-9 md:min-h-[23rem] lg:mt-7 lg:min-h-[24rem]">
              {/* Persistent live region: announced politely on every step change. */}
              <p aria-live="polite" aria-atomic="true" className="text-sm font-bold text-brand-strong tabular-nums">
                {stepCounterLabel(step, total)}
              </p>
              <div className="relative mt-1.5">
                <AnimatePresence initial={false} mode="popLayout" custom={slideCustom}>
                  <SlideText
                    key={slideKey}
                    step={current}
                    index={step}
                    total={total}
                    titleId={titleId}
                    direction={direction}
                    onSwipe={onSwipe}
                  />
                </AnimatePresence>
              </div>
            </div>

            <Controls
              step={step}
              total={total}
              last={last}
              onPrev={() => move(-1)}
              onNext={() => move(1)}
              onDot={(i) => goTo(i)}
              cta={finalCta}
              links={finalLinks}
              className="md:col-start-1 md:row-start-4"
            />
          </div>
        </main>
      </div>
    </MotionConfig>
  );
}

/** "Pilih peran": native radios (arrow keys, names from aria-label), drawn as a segmented control. */
function RoleSwitch({
  role,
  onChange,
  className,
}: {
  role: TourRole;
  onChange: (role: TourRole) => void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Pilih peran"
      className={cn("grid grid-cols-2 gap-1 rounded-full bg-card p-1 shadow-soft ring-1 ring-border md:w-[22rem]", className)}
    >
      {TOUR_ROLES.map((r) => {
        const checked = r === role;
        const Icon = r === "pembeli" ? ShoppingBagIcon : StoreIcon;
        return (
          <label key={r} className="relative">
            {/* The transparent input covers its option (2 px past it vertically: a 44 px target on a
                40 px pill), so taps and clicks land on the radio itself. Its aria-label is the name;
                the visible text is hidden from AT so it is not read twice. */}
            <input
              type="radio"
              name="tur-peran"
              value={r}
              checked={checked}
              onChange={() => onChange(r)}
              aria-label={TOUR_ROLE_LABELS[r]}
              className="peer absolute inset-x-0 -inset-y-0.5 z-10 cursor-pointer appearance-none rounded-full opacity-0"
            />
            <span
              aria-hidden
              className={cn(
                "flex h-10 items-center justify-center gap-2 rounded-full px-3 text-sm font-bold transition-colors md:h-11",
                "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary",
                checked
                  ? "bg-primary text-primary-foreground shadow-soft"
                  : "text-muted-foreground peer-hover:bg-muted peer-hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {TOUR_ROLE_LABELS[r]}
            </span>
          </label>
        );
      })}
    </div>
  );
}

/**
 * Tinted stage with the phone preview. Decorative (aria-hidden): the slide
 * text carries the same information plus an sr-only description. The phone can
 * be dragged sideways (touch or mouse) to change step; motion sets
 * touch-action: pan-y on it, so vertical page scrolling keeps working.
 *
 * The stage is a size container: PhoneFrame reads its height (cqh), --pad and
 * the slide's --focus / --focus-below to scroll each screen to its highlight.
 */
function Stage({
  slideKey,
  step,
  direction,
  onSwipe,
  className,
}: {
  slideKey: string;
  step: TourStep;
  direction: Direction;
  onSwipe: (info: PanInfo) => void;
  className?: string;
}) {
  const { Mock, focusY, focusBelow, clock } = TOUR_MOCKS[step.id];
  const slideCustom = useSlideCustom(direction);
  return (
    <div
      aria-hidden
      className={cn(
        "relative isolate overflow-hidden rounded-[2rem] ring-1 ring-black/[0.04] transition-colors duration-500 [container-type:size] dark:ring-white/[0.06]",
        // --z scales the 316 px phone: 0.78 → ~246 px wide on a 360 px phone, 1.08 → ~341 px on a laptop.
        // --callout is the on-screen size of the coachmark text; --pad the gap above the phone.
        "[--callout:13px] [--pad:14px] [--z:0.78] min-[380px]:[--z:0.82] md:[--pad:40px] md:[--z:0.96] lg:[--callout:14px] lg:[--z:1.08]",
        // Phones: what is left after the header, role switch, slide text and bottom bar (~26.5rem; 28rem
        // below 380 px, where the copy wraps onto one more line), so the body does not run under the bar.
        // md: grows on tall portrait tablets. lg: fits the laptop viewport.
        "h-[clamp(15rem,calc(100svh-28rem),23rem)] min-[380px]:h-[clamp(16rem,calc(100svh-26.5rem),23rem)]",
        "md:h-[min(40rem,calc(100svh-10rem))] lg:h-[min(38rem,calc(100svh-7.5rem))]",
        step.tint === "brand" ? "bg-brand-soft dark:bg-brand-soft/60" : "bg-deal-soft dark:bg-deal-soft/60",
        className,
      )}
    >
      {/* Soft spotlight behind the phone: gives the preview one clear focal point on the tint. */}
      <span className="pointer-events-none absolute top-[14%] left-1/2 -z-10 aspect-square w-[88%] max-w-[30rem] -translate-x-1/2 rounded-full bg-card/50 dark:bg-card/30" />
      <AnimatePresence initial={false} mode="popLayout" custom={slideCustom}>
        <motion.div
          key={slideKey}
          custom={slideCustom}
          variants={SLIDE}
          initial="enter"
          animate="center"
          exit="exit"
          transition={SLIDE_TRANSITION}
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.22}
          onDragEnd={(_, info) => onSwipe(info)}
          // Per slide (not on the stage), so the outgoing screen keeps its own scroll while it leaves.
          style={{ "--focus": `${focusY}px`, "--focus-below": `${focusBelow}px` } as CSSProperties}
          className="absolute inset-0 cursor-grab pt-(--pad) [mask-image:linear-gradient(to_bottom,#000_88%,transparent)] active:cursor-grabbing"
        >
          <PhoneFrame time={clock}>
            <div inert>
              <Mock />
            </div>
          </PhoneFrame>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function SlideText({
  ref,
  step,
  index,
  total,
  titleId,
  direction,
  onSwipe,
}: {
  ref?: Ref<HTMLDivElement>;
  step: TourStep;
  index: number;
  total: number;
  titleId: string;
  direction: Direction;
  onSwipe: (info: PanInfo) => void;
}) {
  // The outgoing slide stays mounted while it animates out: hide it from AT and from clicks.
  const isPresent = useIsPresent();
  const slideCustom = useSlideCustom(direction);
  return (
    <motion.div
      ref={ref}
      role="group"
      aria-roledescription="slide"
      aria-label={slideAriaLabel(index, total)}
      aria-hidden={isPresent ? undefined : true}
      inert={!isPresent}
      custom={slideCustom}
      variants={SLIDE}
      initial="enter"
      animate="center"
      exit="exit"
      transition={SLIDE_TRANSITION}
      // Touch swipe on the text too (mouse drags stay text selection).
      onPanEnd={(e, info) => {
        if ((e as PointerEvent).pointerType !== "mouse") onSwipe(info);
      }}
      style={{ touchAction: "pan-y pinch-zoom" }}
    >
      {/* -mx/px and -my/py: room between the focus ring and the glyphs, without moving the text. */}
      <h2
        id={titleId}
        tabIndex={-1}
        className="-mx-2 -my-1 rounded-lg px-2 py-1 text-[1.65rem] leading-[1.15] font-extrabold text-balance outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:text-[2rem] lg:text-[2.35rem] lg:leading-[1.08] xl:text-[2.6rem]"
      >
        {step.title}
      </h2>
      <p className="mt-2.5 max-w-prose text-[15px] leading-relaxed text-muted-foreground md:text-base lg:mt-4 lg:text-lg">{step.body}</p>
      {/* Phones: the preview and the body carry the step; the bullets stay for screen readers only. */}
      <ul className="mt-4 space-y-2.5 max-md:sr-only lg:mt-6 lg:space-y-3">
        {step.bullets.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-center gap-3 text-sm leading-snug font-medium lg:text-base">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-card text-primary shadow-soft ring-1 ring-border">
              <Icon className="size-4" aria-hidden />
            </span>
            {text}
          </li>
        ))}
      </ul>
      <p className="sr-only">{step.mockLabel}</p>
    </motion.div>
  );
}

/**
 * Dots + Kembali + Lanjut. On the last step the final CTA replaces Lanjut and a
 * compact row of text links (sign in, switch track) follows; on phones the dots
 * give way to that row, so the bar keeps its height on every step.
 */
function Controls({
  step,
  total,
  last,
  onPrev,
  onNext,
  onDot,
  cta,
  links,
  className,
}: {
  step: number;
  total: number;
  last: boolean;
  onPrev: () => void;
  onNext: () => void;
  onDot: (index: number) => void;
  cta: ReactNode;
  links: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // Phone: full-bleed sticky bar, opaque so the scrolled text never shows through; md+: a plain row under the text.
        "sticky bottom-0 z-20 -mx-4 mt-auto border-t border-border/70 bg-background px-4 pt-1 pb-[max(env(safe-area-inset-bottom),0.75rem)]",
        "md:static md:mx-0 md:mt-7 md:border-0 md:bg-transparent md:p-0 lg:mt-6",
        className,
      )}
    >
      <div className={cn("flex justify-center md:-ml-3.5 md:justify-start", last && "max-md:hidden")}>
        {Array.from({ length: total }, (_, i) => {
          const active = i === step;
          return (
            <button
              key={i}
              type="button"
              aria-label={dotAriaLabel(i)}
              aria-current={active ? "step" : undefined}
              onClick={() => onDot(i)}
              className="group inline-flex size-11 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span
                className={cn(
                  "block h-2 rounded-full transition-all duration-300 motion-reduce:transition-none",
                  active ? "w-7 bg-primary" : "w-2 bg-muted-foreground/80 group-hover:bg-foreground",
                )}
              />
            </button>
          );
        })}
      </div>
      <div className={cn("mt-0.5 flex gap-2 md:mt-2", last && "max-md:mt-2")}>
        {step > 0 && (
          // On the last step phones show it as a round icon button, so the final CTA keeps the row.
          <Button
            type="button"
            variant="outline"
            onClick={onPrev}
            className={cn(ACTION, "font-semibold", last && "max-md:w-12 max-md:px-0")}
          >
            <ArrowLeftIcon />
            <span className={cn(last && "max-md:sr-only")}>Kembali</span>
          </Button>
        )}
        {last ? (
          cta
        ) : (
          <Button type="button" onClick={onNext} className={cn(ACTION, "flex-1 md:min-w-44 md:flex-none")}>
            Lanjut
            <ArrowRightIcon />
          </Button>
        )}
      </div>
      {/* md+: keep the links row's height (mt-2 + h-11) on every step, so the centred column does not jump on the last one. */}
      {last ? links : <div aria-hidden className="hidden md:block md:h-13" />}
    </div>
  );
}
