import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LICENCE_URL, PHOTO_CREDITS } from "@/app/(public)/tentang/photo-credits";

const DIR = path.resolve(__dirname, "../../public/food-placeholders");

describe("photo credits on /tentang", () => {
  it("credits every stand-in photo, with the same sources as CREDITS.md", () => {
    const photos = readdirSync(DIR).filter((f) => f.endsWith(".jpg"));
    expect(PHOTO_CREDITS).toHaveLength(photos.length);
    const md = readFileSync(path.join(DIR, "CREDITS.md"), "utf8");
    for (const c of PHOTO_CREDITS) {
      expect(md).toContain(c.sourceUrl);
      expect(md).toContain(c.author);
      expect(c.sourceUrl).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
      expect(LICENCE_URL[c.licence]).toMatch(/^https:\/\/creativecommons\.org\//);
    }
    expect(new Set(PHOTO_CREDITS.map((c) => c.usedFor)).size).toBe(PHOTO_CREDITS.length);
  });
});
