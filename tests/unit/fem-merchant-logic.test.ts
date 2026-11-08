import { describe, expect, it } from "vitest";
import {
  applyStockDelta,
  buildHeatmap,
  ceilTo5Minutes,
  checkPickupEnd,
  clampInt,
  defaultPickupEnd,
  endFromClock,
  escalationLabel,
  formatDuration,
  heatLevel,
  maxDiscountForFloor,
  modelLabel,
  niceCeil,
  parseIntLoose,
  parsePickupCode,
  priceForDiscount,
  sanitizePhone,
  sanitizePinInput,
  stockSegments,
  stripEmpty,
  suggestMinPrice,
} from "@/components/merchant/lib/logic";
import { indonesianZodError } from "@/components/merchant/lib/zod-id";
import { MenuCreateBody, MerchantOnboardingBody, type MerchantBatchView } from "@/lib/contracts";
import { MINUTE_MS } from "@/lib/time";

// 2026-11-08 18:00 WIB (11:00Z)
const EVENING = Date.parse("2026-11-08T11:00:00.000Z");
// 2026-11-08 08:00 WIB (01:00Z)
const MORNING = Date.parse("2026-11-08T01:00:00.000Z");

describe("pickup window defaults", () => {
  it("uses today's closing time when it is a valid window", () => {
    const r = defaultPickupEnd("22:00", EVENING);
    expect(r.source).toBe("closing");
    expect(new Date(r.endMs).toISOString()).toBe("2026-11-08T15:00:00.000Z"); // 22:00 WIB
  });

  it("falls back to now + 2 h (rounded to 5 min) when closing is > 12 h away", () => {
    const r = defaultPickupEnd("22:00", MORNING + 2 * MINUTE_MS);
    expect(r.source).toBe("relative");
    expect(new Date(r.endMs).toISOString()).toBe("2026-11-08T03:05:00.000Z");
  });

  it("falls back when closing already passed or is too close", () => {
    expect(defaultPickupEnd("17:00", EVENING).source).toBe("relative");
    expect(defaultPickupEnd("18:10", EVENING).source).toBe("relative");
    expect(defaultPickupEnd(null, EVENING).source).toBe("relative");
    expect(defaultPickupEnd("garbage", EVENING).source).toBe("relative");
  });

  it("validates > 10 min (+ margin) and ≤ 12 h ahead", () => {
    expect(checkPickupEnd(EVENING + 5 * MINUTE_MS, EVENING)).toMatchObject({ ok: false, reason: "too_soon" });
    expect(checkPickupEnd(EVENING + 11 * MINUTE_MS, EVENING)).toMatchObject({ ok: false, reason: "too_soon" });
    expect(checkPickupEnd(EVENING + 15 * MINUTE_MS, EVENING).ok).toBe(true);
    expect(checkPickupEnd(EVENING + 12 * 60 * MINUTE_MS, EVENING).ok).toBe(true);
    expect(checkPickupEnd(EVENING + 12 * 60 * MINUTE_MS + 1, EVENING)).toMatchObject({ ok: false, reason: "too_far" });
    expect(checkPickupEnd(Number.NaN, EVENING).ok).toBe(false);
  });

  it("maps a typed WIB clock to its next occurrence", () => {
    expect(new Date(endFromClock("21:30", EVENING)!).toISOString()).toBe("2026-11-08T14:30:00.000Z");
    // 17:00 already passed today → tomorrow
    expect(new Date(endFromClock("17:00", EVENING)!).toISOString()).toBe("2026-11-09T10:00:00.000Z");
    expect(endFromClock("25:00", EVENING)).toBeNull();
  });

  it("rounds and formats durations", () => {
    expect(ceilTo5Minutes(Date.parse("2026-11-08T11:01:00Z"))).toBe(Date.parse("2026-11-08T11:05:00Z"));
    expect(ceilTo5Minutes(Date.parse("2026-11-08T11:05:00Z"))).toBe(Date.parse("2026-11-08T11:05:00Z"));
    expect(formatDuration(45)).toBe("45 menit");
    expect(formatDuration(120)).toBe("2 jam");
    expect(formatDuration(135)).toBe("2 j 15 m");
  });
});

describe("stepper clamps & number parsing", () => {
  it("clamps to [min, max] and rounds", () => {
    expect(clampInt(0, 1, 500)).toBe(1);
    expect(clampInt(999, 1, 500)).toBe(500);
    expect(clampInt(7.6, 1, 500)).toBe(8);
    expect(clampInt(Number.NaN, 1, 500)).toBe(1);
  });

  it("parses loosely typed numbers", () => {
    expect(parseIntLoose("Rp 12.500")).toBe(12500);
    expect(parseIntLoose("")).toBeNull();
    expect(parseIntLoose("abc")).toBeNull();
  });

  it("applies optimistic stock deltas with the server's status rules", () => {
    const b = { initial_stock: 8, available_stock: 1, reserved_stock: 0, sold: 7, status: "ACTIVE" } as MerchantBatchView;
    expect(applyStockDelta(b, -1)).toMatchObject({ available_stock: 0, status: "SOLD_OUT" });
    expect(applyStockDelta({ ...b, available_stock: 0, status: "SOLD_OUT" }, 1)).toMatchObject({ available_stock: 1, status: "ACTIVE" });
    expect(applyStockDelta(b, 5)).toMatchObject({ available_stock: 6, initial_stock: 13 });
    expect(applyStockDelta({ ...b, available_stock: 0 }, -1).available_stock).toBe(0);
  });

  it("splits the stock bar into sold / reserved / available", () => {
    const s = stockSegments({ initial_stock: 10, sold: 5, reserved_stock: 2, available_stock: 3 });
    expect(s).toEqual({ sold: 50, reserved: 20, available: 30, total: 10 });
  });
});

describe("prices", () => {
  it("suggests a 30 % floor rounded up to Rp 500", () => {
    expect(suggestMinPrice(18000)).toBe(5500);
    expect(suggestMinPrice(20000)).toBe(6000);
    expect(suggestMinPrice(1000)).toBe(500);
    expect(suggestMinPrice(0)).toBe(0);
  });

  it("mirrors the server price-for-discount (never below floor)", () => {
    expect(priceForDiscount(20000, 6000, 70)).toEqual({ sellingPriceIdr: 6000, discountPct: 70, floorApplied: false });
    expect(priceForDiscount(14000, 4500, 50).sellingPriceIdr).toBe(7000);
    expect(priceForDiscount(14000, 8000, 60)).toMatchObject({ sellingPriceIdr: 8000, floorApplied: true });
    expect(maxDiscountForFloor(18000, 5500)).toBe(69);
    expect(maxDiscountForFloor(10000, 0)).toBe(90);
  });
});

describe("pickup code parsing", () => {
  it.each(["SJ-4829", "sj-4829", "SJ4829", "4829", " SJ 4829 ", "48 29"])("%s → code 4829", (raw) => {
    expect(parsePickupCode(raw)).toEqual({ kind: "code", code: "4829" });
  });

  it("keeps leading zeros and rejects wrong lengths / garbage", () => {
    expect(parsePickupCode("SJ-0042")).toEqual({ kind: "code", code: "0042" });
    expect(parsePickupCode("123")).toBeNull();
    expect(parsePickupCode("12345")).toBeNull();
    expect(parsePickupCode("hello")).toBeNull();
    expect(parsePickupCode("")).toBeNull();
  });

  it("accepts QR tokens and URLs carrying them", () => {
    const token = "3f2b8c1e-7a6d-4e2f-9b1a-0c5d6e7f8a9b.AbCdEfGhIjKlMnOpQrStUv_-12";
    expect(parsePickupCode(token)).toEqual({ kind: "token", value: token });
    expect(parsePickupCode(`https://sisasaji.app/t?t=${token}`)).toEqual({ kind: "token", value: token });
    expect(parsePickupCode("https://example.com/?code=SJ-1234")).toEqual({ kind: "code", code: "1234" });
    expect(parsePickupCode("https://example.com/nothing")).toBeNull();
  });

  it("sanitises typed / pasted PINs", () => {
    expect(sanitizePinInput("SJ-48 29")).toBe("4829");
    expect(sanitizePinInput("sj123456")).toBe("1234");
    expect(sanitizePinInput("ab")).toBe("");
  });
});

describe("heatmap scaling", () => {
  it("levels 0..4 over the observed range", () => {
    expect(heatLevel(0, 8)).toBe(0);
    expect(heatLevel(5, 0)).toBe(0);
    expect(heatLevel(8, 8, 3)).toBe(4);
    expect(heatLevel(3, 8, 3)).toBe(1);
    expect(heatLevel(5.5, 8, 3)).toBe(2);
    expect(heatLevel(5, 5, 5)).toBe(4);
  });

  it("builds menu rows sorted by total, with peak and min", () => {
    const h = buildHeatmap([
      { day_of_week: 0, menu_id: "a", menu_name: "A", avg_surplus_portions: 2, avg_leftover_portions: 0 },
      { day_of_week: 4, menu_id: "b", menu_name: "B", avg_surplus_portions: 8, avg_leftover_portions: 1 },
      { day_of_week: 5, menu_id: "b", menu_name: "B", avg_surplus_portions: 3, avg_leftover_portions: 0 },
    ]);
    expect(h.rows.map((r) => r.menu_id)).toEqual(["b", "a"]);
    expect(h.rows[0].values[4]).toBe(8);
    expect(h.rows[0].values[1]).toBeNull();
    expect(h).toMatchObject({ max: 8, min: 2, peak: { day: 4, menu: "B", value: 8 } });
    expect(buildHeatmap([])).toMatchObject({ rows: [], max: 0, min: 0, peak: null });
  });

  it("nice axis maxima", () => {
    expect(niceCeil(17)).toBe(20);
    expect(niceCeil(21)).toBe(25);
    expect(niceCeil(0)).toBe(1);
    expect(niceCeil(100)).toBe(100);
  });
});

describe("misc helpers", () => {
  it("labels the prediction model", () => {
    expect(modelLabel("lgbm-v1")).toBe("LightGBM");
    expect(modelLabel("heuristic-v0")).toBe("Heuristik");
    expect(modelLabel(null)).toBe("Heuristik");
  });

  it("formats the next escalation", () => {
    expect(escalationLabel({ at: "2026-11-08T14:50:00Z", discount_pct: 70, selling_price_idr: 6000 })).toBe("Naik ke 70% pukul 21.50");
    expect(escalationLabel(null)).toBeNull();
  });

  it("strips blank optional fields and sanitises phones", () => {
    expect(stripEmpty({ a: " x ", b: "", c: undefined, d: 0, e: "  " })).toEqual({ a: "x", d: 0 });
    expect(sanitizePhone("0812-3456 7890")).toBe("081234567890");
    expect(sanitizePhone("+62 812+3")).toBe("+628123");
  });
});

describe("contract schemas with Indonesian messages", () => {
  const opts = { error: indonesianZodError };

  it("menu: floor above normal price uses the contract message", () => {
    const r = MenuCreateBody.safeParse({ menu_name: "Nasi", original_price_idr: 10000, min_recovery_price_idr: 12000 }, opts);
    expect(r.success).toBe(false);
    expect(r.error?.issues.find((i) => i.path[0] === "min_recovery_price_idr")?.message).toBe("Harga minimum tidak boleh melebihi harga normal");
  });

  it("menu: missing / too small prices are Indonesian", () => {
    const r = MenuCreateBody.safeParse({ menu_name: "N", original_price_idr: 500, min_recovery_price_idr: undefined }, opts);
    const msg = (k: string) => r.error?.issues.find((i) => i.path[0] === k)?.message;
    expect(msg("menu_name")).toBe("Minimal 2 karakter");
    expect(msg("original_price_idr")).toBe("Minimal Rp 1.000");
    expect(msg("min_recovery_price_idr")).toBe("Wajib diisi");
  });

  it("onboarding: missing pin asks to drop it on the map", () => {
    const r = MerchantOnboardingBody.safeParse(
      { merchant_name: "Warung Uji", address: "Jl. Kaliurang 5", whatsapp_number: "081234567890", lat: undefined, lng: undefined },
      opts,
    );
    expect(r.error?.issues.find((i) => i.path[0] === "lat")?.message).toBe("Taruh pin lokasi warung di peta");
  });
});
