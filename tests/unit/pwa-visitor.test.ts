/**
 * First-visit flags used by "/" (src/lib/pwa/visitor.ts): "ss-visited" and
 * "ss-tour-seen" live in localStorage, never throw, and are independent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Visitor = typeof import("@/lib/pwa/visitor");

/** Fresh module instance, so storage.ts's in-memory fallback starts empty. */
async function loadVisitor(): Promise<Visitor> {
  vi.resetModules();
  return import("@/lib/pwa/visitor");
}

function fakeLocalStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe("visitor flags", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is a safe no-op without a window (SSR)", async () => {
    const v = await loadVisitor();
    expect(typeof window).toBe("undefined");
    expect(v.hasSeenTour()).toBe(false);
    expect(() => v.markTourSeen()).not.toThrow();
    expect(v.hasSeenTour()).toBe(false);
    expect(v.hasVisited()).toBe(false);
  });

  describe("with localStorage", () => {
    let storage: ReturnType<typeof fakeLocalStorage>;

    beforeEach(() => {
      storage = fakeLocalStorage();
      vi.stubGlobal("window", { localStorage: storage });
    });

    it("markTourSeen stores ss-tour-seen=1 and hasSeenTour reads it back", async () => {
      const v = await loadVisitor();
      expect(v.hasSeenTour()).toBe(false);
      v.markTourSeen();
      expect(storage.data.get("ss-tour-seen")).toBe("1");
      expect(v.hasSeenTour()).toBe(true);
      v.markTourSeen(); // idempotent
      expect(storage.data.get("ss-tour-seen")).toBe("1");
    });

    it("keeps the tour flag independent of the returning-visitor flag", async () => {
      const v = await loadVisitor();
      v.markTourSeen();
      expect(v.hasVisited()).toBe(false);
      expect(storage.data.has("ss-visited")).toBe(false);

      storage.data.delete("ss-tour-seen");
      v.markVisited();
      expect(v.hasVisited()).toBe(true);
      expect(v.hasSeenTour()).toBe(false);
    });

    it("only treats the exact value \"1\" as seen", async () => {
      const v = await loadVisitor();
      storage.data.set("ss-tour-seen", "true");
      expect(v.hasSeenTour()).toBe(false);
    });
  });

  it("falls back to memory when localStorage is blocked (private mode)", async () => {
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    vi.stubGlobal("window", { localStorage: blocked });
    const v = await loadVisitor();
    expect(v.hasSeenTour()).toBe(false);
    expect(() => v.markTourSeen()).not.toThrow();
    expect(v.hasSeenTour()).toBe(true);
  });
});
