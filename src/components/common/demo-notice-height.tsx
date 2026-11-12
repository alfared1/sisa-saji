"use client";

import { useLayoutEffect, useRef } from "react";

/** CSS variable with the space the demo strip takes above the page (height + vertical margins). */
export const DEMO_NOTICE_HEIGHT_VAR = "--demo-notice-h";

/**
 * Publishes the demo strip's height on <html> as `--demo-notice-h`, so
 * full-height screens (/map) can subtract it and keep their bottom edge above
 * the tab bar. The strip wraps to 1–3 lines depending on width and text size,
 * so it is measured instead of guessed. Renders an empty, hidden span inside
 * the strip and measures its parent.
 */
export function DemoNoticeHeight() {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const strip = ref.current?.parentElement;
    if (!strip) return;
    const root = document.documentElement;
    const update = () => {
      const style = getComputedStyle(strip);
      const space =
        style.display === "none"
          ? 0
          : strip.getBoundingClientRect().height + parseFloat(style.marginTop || "0") + parseFloat(style.marginBottom || "0");
      root.style.setProperty(DEMO_NOTICE_HEIGHT_VAR, `${Math.ceil(space)}px`);
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(strip);
    // Margins change at the lg breakpoint without the box itself resizing.
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
      root.style.removeProperty(DEMO_NOTICE_HEIGHT_VAR);
    };
  }, []);

  return <span ref={ref} hidden />;
}
