import { describe, expect, it } from "vitest";
import {
  DEFAULT_SWIPE,
  TOUR_ROLE_LABELS,
  arrowKeyIntent,
  clampStep,
  dotAriaLabel,
  isFirstStep,
  isLastStep,
  nextStep,
  parseRole,
  parseStepParam,
  prevStep,
  skipTarget,
  slideAriaLabel,
  stepCounterLabel,
  swipeIntent,
  targetOwnsArrowKeys,
  tourHref,
} from "@/components/tour/tour-logic";
import { TOUR_STEPS, keepTogether } from "@/components/tour/tour-steps";

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const NBSP = String.fromCharCode(0x00a0);
const WJ = String.fromCharCode(0x2060);
const NB_HYPHEN = String.fromCharCode(0x2011);

/** Copy as a reader sees it: no-break characters back to plain spaces and hyphens. */
const plain = (s: string) => s.split(NBSP).join(" ").split(WJ).join("").split(NB_HYPHEN).join("-");

describe("parseRole (?peran)", () => {
  it("opens the merchant track only for 'mitra'", () => {
    expect(parseRole("mitra")).toBe("mitra");
    expect(parseRole(" Mitra ")).toBe("mitra");
  });
  it("falls back to pembeli for anything else", () => {
    for (const v of [null, undefined, "", "pembeli", "merchant", "MERCHANT", "mitra-warung"]) {
      expect(parseRole(v)).toBe("pembeli");
    }
  });
});

describe("step index helpers", () => {
  it("clamps into range and survives junk", () => {
    expect(clampStep(-3, 5)).toBe(0);
    expect(clampStep(2, 5)).toBe(2);
    expect(clampStep(9, 5)).toBe(4);
    expect(clampStep(2.9, 5)).toBe(2);
    expect(clampStep(Number.NaN, 5)).toBe(0);
    expect(clampStep(Infinity, 5)).toBe(0);
    expect(clampStep(3, 0)).toBe(0);
  });

  it("reads ?langkah as 1-based and clamps it", () => {
    expect(parseStepParam(null, 5)).toBe(0);
    expect(parseStepParam("", 5)).toBe(0);
    expect(parseStepParam("1", 5)).toBe(0);
    expect(parseStepParam("3", 5)).toBe(2);
    expect(parseStepParam("99", 5)).toBe(4);
    expect(parseStepParam("0", 5)).toBe(0);
    expect(parseStepParam("-2", 5)).toBe(0);
    expect(parseStepParam("dua", 5)).toBe(0);
  });

  it("moves one step and stops at both ends", () => {
    expect(nextStep(0, 5)).toBe(1);
    expect(nextStep(4, 5)).toBe(4);
    expect(prevStep(3, 5)).toBe(2);
    expect(prevStep(0, 5)).toBe(0);
    expect(isFirstStep(0)).toBe(true);
    expect(isFirstStep(1)).toBe(false);
    expect(isLastStep(4, 5)).toBe(true);
    expect(isLastStep(3, 5)).toBe(false);
  });
});

describe("labels the e2e suite and screen readers rely on", () => {
  it("formats the counter, slide label and dot names", () => {
    expect(stepCounterLabel(1, 5)).toBe("Langkah 2 dari 5");
    expect(slideAriaLabel(0, 5)).toBe("1 dari 5");
    expect(dotAriaLabel(2)).toBe("Ke langkah 3");
    expect(TOUR_ROLE_LABELS).toEqual({ pembeli: "Pembeli", mitra: "Mitra Warung" });
  });

  it("keeps ?peran in the URL and picks the skip destination", () => {
    expect(tourHref("mitra")).toBe("/tour?peran=mitra");
    expect(tourHref("pembeli")).toBe("/tour?peran=pembeli");
    expect(skipTarget(false)).toBe("/welcome");
    expect(skipTarget(true)).toBe("/");
    // Session not known yet: "/" waits for it and routes by role.
    expect(skipTarget(null)).toBe("/");
  });
});

describe("swipeIntent", () => {
  it("treats a long leftward drag as next and rightward as previous", () => {
    expect(swipeIntent({ offsetX: -90, velocityX: -50 })).toBe(1);
    expect(swipeIntent({ offsetX: 90, velocityX: 50 })).toBe(-1);
  });

  it("accepts a short, fast flick in the same direction", () => {
    expect(swipeIntent({ offsetX: -30, velocityX: -800 })).toBe(1);
    expect(swipeIntent({ offsetX: 30, velocityX: 800 })).toBe(-1);
  });

  it("ignores taps, slow short drags and flicks that reverse direction", () => {
    expect(swipeIntent({ offsetX: -5, velocityX: -2000 })).toBe(0);
    expect(swipeIntent({ offsetX: -40, velocityX: -100 })).toBe(0);
    expect(swipeIntent({ offsetX: -30, velocityX: 900 })).toBe(0);
  });

  it("never hijacks a mostly vertical gesture (page scroll)", () => {
    expect(swipeIntent({ offsetX: -80, offsetY: 200, velocityX: -900 })).toBe(0);
    expect(swipeIntent({ offsetX: 70, offsetY: -71, velocityX: 600 })).toBe(0);
  });

  it("uses the distance threshold exactly and rejects non-finite input", () => {
    expect(swipeIntent({ offsetX: -DEFAULT_SWIPE.distance, velocityX: 0 })).toBe(1);
    expect(swipeIntent({ offsetX: -(DEFAULT_SWIPE.distance - 1), velocityX: 0 })).toBe(0);
    expect(swipeIntent({ offsetX: Number.NaN, velocityX: 0 })).toBe(0);
  });
});

describe("keyboard", () => {
  it("maps plain arrow keys only", () => {
    expect(arrowKeyIntent({ key: "ArrowRight" })).toBe(1);
    expect(arrowKeyIntent({ key: "ArrowLeft" })).toBe(-1);
    expect(arrowKeyIntent({ key: "ArrowUp" })).toBe(0);
    expect(arrowKeyIntent({ key: "Enter" })).toBe(0);
    expect(arrowKeyIntent({ key: "ArrowRight", altKey: true })).toBe(0);
    expect(arrowKeyIntent({ key: "ArrowLeft", metaKey: true })).toBe(0);
    expect(arrowKeyIntent({ key: "ArrowRight", shiftKey: true })).toBe(0);
  });

  it("leaves arrow keys to text fields, radios and other composite widgets", () => {
    expect(targetOwnsArrowKeys({ tagName: "INPUT" })).toBe(true);
    expect(targetOwnsArrowKeys({ tagName: "textarea" })).toBe(true);
    expect(targetOwnsArrowKeys({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(targetOwnsArrowKeys({ tagName: "BUTTON", role: "radio" })).toBe(true);
    expect(targetOwnsArrowKeys({ tagName: "BUTTON", ancestorRole: "radiogroup" })).toBe(true);
    expect(targetOwnsArrowKeys({ tagName: "BUTTON", ancestorRole: "region" })).toBe(false);
    expect(targetOwnsArrowKeys({ tagName: "H2", ancestorRole: "group" })).toBe(false);
  });
});

describe("tour content", () => {
  it("has five distinct steps per track with short copy", () => {
    for (const steps of Object.values(TOUR_STEPS)) {
      expect(steps).toHaveLength(5);
      expect(new Set(steps.map((s) => s.title)).size).toBe(5);
      for (const s of steps) {
        expect(s.bullets.length).toBeGreaterThanOrEqual(2);
        expect(s.bullets.length).toBeLessThanOrEqual(3);
        // Body: at most two sentences.
        expect(s.body.split(/[.!?](?:\s|$)/).filter((x) => x.trim()).length).toBeLessThanOrEqual(2);
        expect(s.mockLabel.length).toBeGreaterThan(0);
      }
    }
  });

  it("never uses an em dash or the term 'makanan bekas'", () => {
    const text = JSON.stringify(
      Object.values(TOUR_STEPS)
        .flat()
        .map((s) => [s.title, s.body, s.mockLabel, ...s.bullets.map((b) => b.text)]),
    );
    expect(text).not.toContain(EM_DASH);
    expect(text.toLowerCase()).not.toContain("makanan bekas");
  });

  it("states the numbers the app enforces", () => {
    const all = plain(
      JSON.stringify(Object.values(TOUR_STEPS).flat().map((s) => [s.body, ...s.bullets.map((b) => b.text)])),
    );
    expect(all).toContain(`20.00${EN_DASH}23.00 WIB`);
    expect(all).toContain("Rp 1.500");
    expect(all).toContain("dikunci 10 menit");
    expect(all).toContain("radius 2 km");
  });

  it("matches the research update: no 70% claim, the lock button, cash hold and quick filters", () => {
    const all = plain(
      JSON.stringify(Object.values(TOUR_STEPS).flat().map((s) => [s.title, s.body, s.mockLabel, ...s.bullets.map((b) => b.text)])),
    );
    expect(all).not.toContain("70%");
    expect(all).not.toMatch(/kejutan|OVO/i);
    expect(plain(TOUR_STEPS.pembeli[0].title)).toBe("Makan malam kenyang mulai Rp 10.000");
    expect(TOUR_STEPS.pembeli[0].bullets.at(-1)?.text).toContain("CO₂e");
    expect(all).toContain("Kunci Porsi Sekarang");
    expect(all).toContain("Bayar tunai di warung dengan porsi ditahan 30 menit");
    expect(all).toContain("< 500 m");
  });
});

describe("keepTogether", () => {
  it("binds numbers to units, Rp to amounts and both ends of a time range", () => {
    expect(keepTogether("radius 2 km")).toBe(`radius 2${NBSP}km`);
    expect(keepTogether("biaya Rp 1.500")).toBe(`biaya Rp${NBSP}1.500`);
    expect(keepTogether(`20.00${EN_DASH}23.00 WIB`)).toBe(`20.00${WJ}${EN_DASH}${WJ}23.00${NBSP}WIB`);
    expect(keepTogether("pakai m-banking")).toBe(`pakai m${NB_HYPHEN}banking`);
    expect(keepTogether("di HP-mu")).toBe(`di HP${NB_HYPHEN}mu`);
  });

  it("leaves other words alone", () => {
    expect(keepTogether("2 kali makan, gramnya pas")).toBe("2 kali makan, gramnya pas");
    expect(keepTogether("kode SJ-8515")).toBe("kode SJ-8515");
  });
});
