import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME,
  THEME_COLORS,
  THEME_OPTIONS,
  THEME_STORAGE_KEY,
  isResolvedTheme,
  isThemeChoice,
  themeColorBootScript,
  themeColorFor,
  themeHint,
  themeLabel,
} from "@/lib/theme";

const EM_DASH = String.fromCharCode(0x2014);

describe("THEME_OPTIONS", () => {
  it("lists Terang, Gelap, Sistem in that order with distinct icons", () => {
    expect(THEME_OPTIONS.map((o) => [o.value, o.label])).toEqual([
      ["light", "Terang"],
      ["dark", "Gelap"],
      ["system", "Sistem"],
    ]);
    expect(new Set(THEME_OPTIONS.map((o) => o.icon)).size).toBe(THEME_OPTIONS.length);
  });

  it("defaults to Sistem under next-themes' own storage key", () => {
    expect(DEFAULT_THEME).toBe("system");
    expect(THEME_STORAGE_KEY).toBe("theme");
  });

  it("labels every choice", () => {
    expect(themeLabel("light")).toBe("Terang");
    expect(themeLabel("dark")).toBe("Gelap");
    expect(themeLabel("system")).toBe("Sistem");
  });
});

describe("guards", () => {
  it("isThemeChoice accepts exactly light, dark and system", () => {
    for (const v of ["light", "dark", "system"]) expect(isThemeChoice(v)).toBe(true);
    for (const v of [undefined, null, "", "Dark", "auto", 1, {}]) expect(isThemeChoice(v)).toBe(false);
  });

  it("isResolvedTheme rejects system", () => {
    expect(isResolvedTheme("light")).toBe(true);
    expect(isResolvedTheme("dark")).toBe(true);
    expect(isResolvedTheme("system")).toBe(false);
    expect(isResolvedTheme(undefined)).toBe(false);
  });
});

describe("THEME_COLORS", () => {
  it("are 6-digit hex colours, one per resolved theme", () => {
    expect(Object.keys(THEME_COLORS).sort()).toEqual(["dark", "light"]);
    for (const c of Object.values(THEME_COLORS)) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    expect(THEME_COLORS.light).not.toBe(THEME_COLORS.dark);
  });

  it("themeColorFor maps dark to the dark colour and anything else to light", () => {
    expect(themeColorFor("dark")).toBe(THEME_COLORS.dark);
    expect(themeColorFor("light")).toBe(THEME_COLORS.light);
    expect(themeColorFor(undefined)).toBe(THEME_COLORS.light);
    expect(themeColorFor("system")).toBe(THEME_COLORS.light);
  });

  it("match the --background of each theme in globals.css (the bar blends into the page)", () => {
    const css = readFileSync(path.resolve(__dirname, "../../src/app/globals.css"), "utf8");
    const background = (selector: string) => {
      const block = css.match(new RegExp(`(^|\n)${selector.replace(".", "\.")} \{([^}]*)\}`))?.[2] ?? "";
      const m = block.match(/--background:\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/);
      if (!m) throw new Error(`no oklch --background in ${selector}`);
      return oklchToRgb(Number(m[1]), Number(m[2]), Number(m[3]));
    };
    for (const [selector, hex] of [
      [":root", THEME_COLORS.light],
      [".dark", THEME_COLORS.dark],
    ] as const) {
      const expected = background(selector);
      const actual = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      actual.forEach((c, i) => expect(Math.abs(c - expected[i]), `${selector} channel ${i}`).toBeLessThanOrEqual(2));
    }
  });

  it("are the single source for the viewport metadata in layout.tsx", () => {
    const layout = readFileSync(path.resolve(__dirname, "../../src/app/layout.tsx"), "utf8");
    expect(layout).toContain("THEME_COLORS.light");
    expect(layout).toContain("THEME_COLORS.dark");
    expect(layout).not.toMatch(/#[0-9a-f]{6}/i);
  });
});

describe("themeHint", () => {
  it("is empty while the choice is unknown (server render, hydration pass)", () => {
    expect(themeHint(undefined, undefined)).toBe("");
    expect(themeHint("auto", "dark")).toBe("");
  });

  it("describes a fixed choice regardless of the device", () => {
    expect(themeHint("light", "light")).toBe("Tetap terang, siang maupun malam");
    expect(themeHint("dark", "dark")).toBe("Tetap gelap, nyaman di mata saat malam");
  });

  it("says what the device uses right now for Sistem", () => {
    expect(themeHint("system", "dark")).toBe("Mengikuti perangkat · saat ini gelap");
    expect(themeHint("system", "light")).toBe("Mengikuti perangkat · saat ini terang");
    expect(themeHint("system", undefined)).toBe("Mengikuti pengaturan perangkat");
    expect(themeHint("system", "blue")).toBe("Mengikuti pengaturan perangkat");
  });

  it("uses no em dash and stays one short line", () => {
    for (const theme of ["light", "dark", "system"]) {
      for (const resolved of ["light", "dark", undefined]) {
        const hint = themeHint(theme, resolved);
        expect(hint).not.toContain(EM_DASH);
        expect(hint.length).toBeLessThanOrEqual(40);
      }
    }
  });
});

/** OKLCH (CSS, L in 0..1) to 8-bit sRGB, per the CSS Color 4 matrices. */
function oklchToRgb(L: number, C: number, h: number): number[] {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return linear.map((x) => {
    const c = Math.min(1, Math.max(0, x));
    return Math.round((c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) * 255);
  });
}

type FakeMeta = { content: string; media: string };

const LAYOUT_PAIR: FakeMeta[] = [
  { content: THEME_COLORS.light, media: "(prefers-color-scheme: light)" },
  { content: THEME_COLORS.dark, media: "(prefers-color-scheme: dark)" },
];

/** Runs the boot script against a fake document (by default the light/dark meta pair from layout.tsx). */
function runBootScript(
  stored: string | null,
  opts: { throwOnStorage?: boolean; metas?: FakeMeta[] } = {},
): { metas: FakeMeta[]; removed: string[] } {
  const metas = (opts.metas ?? LAYOUT_PAIR).map((m) => {
    const attrs: Record<string, string> = { ...m };
    return {
      attrs,
      getAttribute: (k: string) => attrs[k] ?? null,
      setAttribute: (k: string, v: string) => {
        attrs[k] = v;
      },
    };
  });
  const removed: string[] = [];
  const sandbox = {
    localStorage: {
      getItem: (k: string) => {
        if (opts.throwOnStorage) throw new Error("blocked");
        return k === THEME_STORAGE_KEY ? stored : null;
      },
      removeItem: (k: string) => {
        removed.push(k);
      },
    },
    document: { querySelectorAll: () => metas },
  };
  runInNewContext(themeColorBootScript(), sandbox);
  return { metas: metas.map((m) => ({ content: m.attrs.content, media: m.attrs.media })), removed };
}

describe("themeColorBootScript", () => {
  it("enables only the chosen colour for a manual choice and never edits content", () => {
    expect(runBootScript("dark")).toEqual({
      metas: [
        { content: THEME_COLORS.light, media: "not all" },
        { content: THEME_COLORS.dark, media: "all" },
      ],
      removed: [],
    });
    expect(runBootScript("light").metas).toEqual([
      { content: THEME_COLORS.light, media: "all" },
      { content: THEME_COLORS.dark, media: "not all" },
    ]);
  });

  it("matches tags by colour, not by position or count", () => {
    const reversed = [...LAYOUT_PAIR].reverse();
    expect(runBootScript("dark", { metas: reversed }).metas).toEqual([
      { content: THEME_COLORS.dark, media: "all" },
      { content: THEME_COLORS.light, media: "not all" },
    ]);
    const three = [...LAYOUT_PAIR, { content: THEME_COLORS.dark, media: "(prefers-color-scheme: dark)" }];
    expect(runBootScript("dark", { metas: three }).metas.map((m) => m.media)).toEqual(["not all", "all", "all"]);
    expect(runBootScript("light", { metas: [LAYOUT_PAIR[1]] }).metas).toEqual([{ content: THEME_COLORS.dark, media: "not all" }]);
  });

  it("disables a tag whose colour is neither theme's", () => {
    const stray = { content: "#123456", media: "all" };
    expect(runBootScript("dark", { metas: [...LAYOUT_PAIR, stray] }).metas[2]).toEqual({ content: "#123456", media: "not all" });
  });

  it("keeps the media-query pair for Sistem, nothing stored, or blocked storage", () => {
    expect(runBootScript("system")).toEqual({ metas: LAYOUT_PAIR, removed: [] });
    expect(runBootScript(null)).toEqual({ metas: LAYOUT_PAIR, removed: [] });
    expect(runBootScript("dark", { throwOnStorage: true })).toEqual({ metas: LAYOUT_PAIR, removed: [] });
  });

  it("drops any other stored value, so next-themes falls back to Sistem", () => {
    for (const junk of ["blue", "constructor", "", "Dark", "auto"]) {
      expect(runBootScript(junk), junk).toEqual({ metas: LAYOUT_PAIR, removed: [THEME_STORAGE_KEY] });
    }
  });

  it("is safe to inline in a <script> tag", () => {
    expect(themeColorBootScript()).not.toMatch(/<\/script|<!--/i);
  });
});
