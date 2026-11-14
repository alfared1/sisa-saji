import { describe, expect, it } from "vitest";
import { formatCountdownText } from "@/components/common/countdown-format";
import { distanceLine } from "@/components/customer/lib/format";
import { cartItemFromBatch, cartPatchFromBatch } from "@/components/customer/lib/queries";
import {
  BATCH_PHOTO_MAX_BYTES,
  DEMO_BATCH_PHOTO_TTL_MINUTES,
  PLATFORM_COMMISSION_DEFAULT_IDR,
  TRUST_SIGNAL_MIN_REVIEWS,
} from "@/lib/constants";
import {
  BUYER_MENU_CATEGORIES,
  BatchPatchBody,
  CheckoutBody,
  HungerAlertBody,
  MenuCreateBody,
  MenuUpdateBody,
  PublishBody,
  type BatchCard,
} from "@/lib/contracts";
import { inspectImage, jpegDimensions, sniffImageType } from "@/lib/image-sniff";
import { defaultLauk, findItem, isSubset, laukLabel, laukSoldOut, lineKey, normalizeItems } from "@/lib/lauk";
import { serviceFeeFor } from "@/lib/pricing/order-totals";
import { hygieneText, portionChipText, portionText, ratingText, toTrustSignals } from "@/lib/trust-signals";
import {
  batchPhotoFromRow,
  batchPhotoUrl,
  canViewBatchPhoto,
  photoCacheControl,
  photoVisibility,
} from "@/server/services/batch-photos";
import { ApiError, readImageBody } from "@/server/http";

/* ------------------------------------------------------------------ */
/* Lauk                                                                */
/* ------------------------------------------------------------------ */

describe("lauk helpers", () => {
  it("normalises items: trims, collapses spaces, drops empties and case-insensitive repeats, keeps order", () => {
    expect(normalizeItems(["  Ayam  goreng ", "Pepes ikan mas", "ayam GORENG", "", "   ", "Tahu tempe"])).toEqual([
      "Ayam goreng",
      "Pepes ikan mas",
      "Tahu tempe",
    ]);
  });

  it("checks subsets and finds items ignoring case, in the stored casing", () => {
    const options = ["Ayam goreng", "Pepes ikan mas", "Tahu tempe bacem"];
    expect(isSubset(["ayam goreng", "Tahu  tempe bacem"], options)).toBe(true);
    expect(isSubset(["Ayam bakar"], options)).toBe(false);
    expect(isSubset([], options)).toBe(true);
    expect(findItem(options, "PEPES IKAN MAS")).toBe("Pepes ikan mas");
    expect(findItem(options, "Rendang")).toBeNull();
  });

  it("derives the default lauk, the sold-out ones, the label and the line key", () => {
    const batch = { lauk_options: ["Ayam goreng", "Pepes ikan mas", "Tahu tempe bacem"], lauk_available: ["Pepes ikan mas", "Ayam goreng"] };
    expect(defaultLauk(batch)).toBe("Pepes ikan mas");
    expect(defaultLauk({ lauk_available: [] })).toBeNull();
    expect(laukSoldOut(batch)).toEqual(["Tahu tempe bacem"]);
    expect(laukLabel("MAKANAN_BERAT")).toBe("Pilih lauk");
    expect(laukLabel("MAKANAN_VEGAN")).toBe("Pilih lauk");
    expect(laukLabel("ROTI_PASTRY")).toBe("Pilih varian");
    expect(lineKey("b1", "Ayam goreng")).toBe("b1|Ayam goreng");
    expect(lineKey("b1", null)).toBe("b1|");
  });
});

/* ------------------------------------------------------------------ */
/* Trust signals                                                       */
/* ------------------------------------------------------------------ */

describe("trust signals", () => {
  const n = TRUST_SIGNAL_MIN_REVIEWS;

  it("stays null below the review threshold and appears at it", () => {
    expect(toTrustSignals({ hygieneAvg: "4.87", hygieneCount: n - 1, portionFullCount: n - 1, portionAnswerCount: n - 1 })).toEqual({
      hygiene: null,
      portion_full: null,
    });
    expect(toTrustSignals({ hygieneAvg: "4.87", hygieneCount: n, portionFullCount: n, portionAnswerCount: n })).toEqual({
      hygiene: { avg: 4.9, count: n },
      portion_full: { pct: 100, count: n },
    });
    // No answers yet: never a default score.
    expect(toTrustSignals({ hygieneAvg: null, hygieneCount: 0, portionFullCount: 0, portionAnswerCount: 0 }).hygiene).toBeNull();
  });

  it("words hygiene in short and long form, counting reviews", () => {
    const t = toTrustSignals({ hygieneAvg: 4.9, hygieneCount: 42, portionFullCount: 0, portionAnswerCount: 0 });
    expect(hygieneText(t, "short")).toBe("Kebersihan 4,9/5");
    expect(hygieneText(t, "long")).toBe("Kebersihan 4,9/5 dari 42 ulasan");
    expect(portionText(t, "long")).toBeNull();
  });

  it("only says 100% when the data says 100%, and words a share under 90% differently", () => {
    const all = toTrustSignals({ hygieneAvg: null, hygieneCount: 0, portionFullCount: 40, portionAnswerCount: 40 });
    expect(portionText(all, "short")).toBe("Porsi normal 100%");
    expect(portionText(all, "long")).toBe("Porsi normal 100% (kenyang) dari 40 ulasan");

    const most = toTrustSignals({ hygieneAvg: null, hygieneCount: 0, portionFullCount: 38, portionAnswerCount: 40 });
    expect(portionText(most, "short")).toBe("Porsi normal 95%");
    expect(portionText(most, "long")).toBe("Porsi normal 95% (kenyang) dari 40 ulasan");

    const some = toTrustSignals({ hygieneAvg: null, hygieneCount: 0, portionFullCount: 28, portionAnswerCount: 40 });
    expect(portionText(some, "short")).toBe("Porsi pas menurut 70% ulasan");
    expect(portionText(some, "long")).toBe("Porsi normal menurut 70% dari 40 ulasan");
  });

  it("picks the card portion chip: disclosure, then reviews, then the warung's promise", () => {
    const none = toTrustSignals({ hygieneAvg: null, hygieneCount: 0, portionFullCount: 0, portionAnswerCount: 0 });
    const most = toTrustSignals({ hygieneAvg: null, hygieneCount: 0, portionFullCount: 38, portionAnswerCount: 40 });
    expect(portionChipText(most, false)).toBe("Porsi lebih kecil");
    expect(portionChipText(most, true)).toBe("Porsi normal 95%");
    expect(portionChipText(none, true)).toBe("Janji porsi normal");
    expect(portionChipText(none, false)).toBe("Porsi lebih kecil");
  });

  it("says 'Belum ada ulasan' instead of a default 5,0 (0)", () => {
    expect(ratingText(5, 0)).toBe("Belum ada ulasan");
    expect(ratingText(4.6, 65)).toBe("4,6 (65)");
    expect(ratingText(4.6, 65, "long")).toBe("4,6 (65 ulasan)");
  });
});

/* ------------------------------------------------------------------ */
/* Image checks                                                        */
/* ------------------------------------------------------------------ */

/** A minimal JPEG header: SOI, an APP0 segment, a SOF0 frame of width × height, then SOS. */
function jpeg(width: number, height: number, sof = 0xc0): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const frame = [0xff, sof, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const sos = [0xff, 0xda, 0x00, 0x0c, 0x03, 1, 0, 2, 0x11, 3, 0x11, 0x00, 0x3f, 0x00, 0x12, 0x34, 0xff, 0xd9];
  return Uint8Array.from([0xff, 0xd8, ...app0, ...frame, ...sos]);
}
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

describe("image sniff (JPEG only)", () => {
  it("accepts JPEG and reads its frame size, also from a progressive frame", () => {
    expect(sniffImageType(jpeg(1280, 960))).toBe("image/jpeg");
    expect(jpegDimensions(jpeg(1280, 960))).toEqual({ width: 1280, height: 960 });
    expect(jpegDimensions(jpeg(800, 600, 0xc2))).toEqual({ width: 800, height: 600 });
    expect(inspectImage(jpeg(1280, 960))).toEqual({ ok: true, contentType: "image/jpeg", width: 1280, height: 960 });
  });

  it("rejects WebP, PNG, SVG, empty and truncated input", () => {
    for (const bytes of [WEBP, PNG, SVG, new Uint8Array(0), Uint8Array.from([0xff, 0xd8, 0xff])]) {
      expect(inspectImage(bytes)).toEqual({ ok: false, reason: "type" });
    }
    expect(sniffImageType(PNG)).toBeNull();
    expect(sniffImageType(WEBP)).toBeNull();
  });

  it("rejects frames above 2560 px on an edge or 4 MP in total", () => {
    expect(inspectImage(jpeg(30000, 30000))).toEqual({ ok: false, reason: "dimensions" });
    expect(inspectImage(jpeg(2561, 100))).toEqual({ ok: false, reason: "dimensions" });
    expect(inspectImage(jpeg(2560, 1600))).toEqual({ ok: false, reason: "dimensions" });
    expect(inspectImage(jpeg(2560, 1500)).ok).toBe(true);
    expect(inspectImage(jpeg(0, 100))).toEqual({ ok: false, reason: "type" });
  });
});

describe("readImageBody", () => {
  const upload = (body: BodyInit, headers: Record<string, string> = {}) =>
    new Request("http://localhost/api/v1/merchant/surplus/x/photo", { method: "POST", body, headers });
  const streamOf = (bytes: Uint8Array, chunk = 1000) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < bytes.length; i += chunk) c.enqueue(bytes.slice(i, i + chunk));
        c.close();
      },
    });
  const rejection = async (p: Promise<unknown>) => {
    const err = await p.then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    return err as ApiError;
  };

  it("returns the bytes of a valid JPEG", async () => {
    const bytes = jpeg(1280, 960);
    const out = await readImageBody(upload(bytes as BodyInit, { "content-type": "image/jpeg" }), BATCH_PHOTO_MAX_BYTES);
    expect(out.contentType).toBe("image/jpeg");
    expect(out.bytes.equals(Buffer.from(bytes))).toBe(true);
    expect([out.width, out.height]).toEqual([1280, 960]);
  });

  it("refuses a declared size above the cap before reading (413)", async () => {
    const err = await rejection(readImageBody(upload(jpeg(10, 10) as BodyInit, { "content-length": String(BATCH_PHOTO_MAX_BYTES + 1) }), BATCH_PHOTO_MAX_BYTES));
    expect(err.status).toBe(413);
  });

  it("stops reading a body without Content-Length once it passes the cap (413)", async () => {
    const big = new Uint8Array(5000);
    big.set(jpeg(10, 10));
    const req = new Request("http://localhost/x", { method: "POST", body: streamOf(big), duplex: "half" } as RequestInit);
    const err = await rejection(readImageBody(req, 4096));
    expect(err.status).toBe(413);
    expect(err.message).toContain("Foto terlalu besar");
  });

  it("refuses other formats with 415, oversized frames and empty bodies with 400", async () => {
    expect((await rejection(readImageBody(upload(PNG as BodyInit), BATCH_PHOTO_MAX_BYTES))).status).toBe(415);
    expect((await rejection(readImageBody(upload(SVG as BodyInit), BATCH_PHOTO_MAX_BYTES))).status).toBe(415);
    expect((await rejection(readImageBody(upload(jpeg(9000, 9000) as BodyInit), BATCH_PHOTO_MAX_BYTES))).status).toBe(400);
    expect((await rejection(readImageBody(upload(new Uint8Array(0) as BodyInit), BATCH_PHOTO_MAX_BYTES))).status).toBe(400);
  });
});

/* ------------------------------------------------------------------ */
/* Money, distance, countdown                                          */
/* ------------------------------------------------------------------ */

describe("serviceFeeFor", () => {
  it("charges no fee for cash at the warung and the normal fee otherwise", () => {
    expect(serviceFeeFor("BAYAR_DI_WARUNG")).toBe(0);
    for (const m of ["QRIS", "GOPAY", "DANA", "OVO"] as const) expect(serviceFeeFor(m)).toBe(PLATFORM_COMMISSION_DEFAULT_IDR);
  });
});

describe("distanceLine", () => {
  const gps = { source: "gps", label: "Lokasi kamu saat ini" } as const;
  const campus = { source: "campus", label: "IPB Dramaga, Bogor" } as const;
  const manual = { source: "manual", label: "Titik pilihan" } as const;

  it("says 'bisa jalan kaki' up to 500 m and names the place by its source", () => {
    expect(distanceLine(350, gps, "long")).toBe("350 m dari lokasi kamu, bisa jalan kaki");
    expect(distanceLine(500, manual, "long")).toBe("500 m dari titik pilihanmu, bisa jalan kaki");
    expect(distanceLine(350, campus, "long")).toBe("350 m dari IPB Dramaga, Bogor, bisa jalan kaki");
    expect(distanceLine(350, gps, "short")).toBe("350 m · jalan kaki");
  });

  it("gives walking minutes up to 1,5 km and plain distance beyond", () => {
    expect(distanceLine(501, gps, "long")).toBe("500 m dari lokasi kamu · 6 mnt jalan kaki");
    expect(distanceLine(750, gps, "long")).toBe("750 m dari lokasi kamu · 9 mnt jalan kaki");
    expect(distanceLine(1500, gps, "short")).toBe("1,5 km · 19 mnt jalan");
    expect(distanceLine(1501, gps, "short")).toBe("1,5 km");
    expect(distanceLine(2400, campus, "long")).toBe("2,4 km dari IPB Dramaga, Bogor");
    expect(distanceLine(null, gps, "long")).toBe("");
  });
});

describe("formatCountdownText", () => {
  it("reads 'Tutup dalam HH:MM:SS'", () => {
    expect(formatCountdownText({ hours: 1, minutes: 15, seconds: 20 }, "Tutup dalam")).toBe("Tutup dalam 01:15:20");
    expect(formatCountdownText({ hours: 0, minutes: 5, seconds: 3 }, "")).toBe("00:05:03");
  });
});

/* ------------------------------------------------------------------ */
/* Batch photo visibility                                              */
/* ------------------------------------------------------------------ */

describe("batch photo visibility", () => {
  const now = new Date("2026-11-14T13:00:00.000Z");
  const live = {
    batchStatus: "ACTIVE" as const,
    pickupEndTime: new Date(now.getTime() + 60 * 60_000),
    uploadedAt: new Date(now.getTime() - 10 * 60_000),
  };
  const anon = { isDemo: false, ownsMerchant: false };
  const demo = { isDemo: true, ownsMerchant: false };
  const owner = { isDemo: false, ownsMerchant: true };

  it("classifies photos by uploader and warung", () => {
    expect(photoVisibility({ demoOnly: false, merchantIsPilot: true })).toBe("PUBLIC");
    expect(photoVisibility({ demoOnly: true, merchantIsPilot: false })).toBe("DEMO");
    expect(photoVisibility({ demoOnly: true, merchantIsPilot: true })).toBe("DEMO");
    expect(photoVisibility({ demoOnly: false, merchantIsPilot: false })).toBe("OWNER");
    expect(photoCacheControl("PUBLIC")).toBe("public, max-age=3600");
    expect(photoCacheControl("DEMO")).toBe("private, no-store");
    expect(photoCacheControl("OWNER")).toBe("private, no-store");
  });

  it("shows pilot photos to everyone, demo photos to demo sessions and the owner, others to the owner only", () => {
    const pilot = { ...live, demoOnly: false, merchantIsPilot: true };
    const demoPhoto = { ...live, demoOnly: true, merchantIsPilot: false };
    const selfRegistered = { ...live, demoOnly: false, merchantIsPilot: false };
    expect([anon, demo, owner].map((v) => canViewBatchPhoto(pilot, v, now))).toEqual([true, true, true]);
    expect([anon, demo, owner].map((v) => canViewBatchPhoto(demoPhoto, v, now))).toEqual([false, true, true]);
    expect([anon, demo, owner].map((v) => canViewBatchPhoto(selfRegistered, v, now))).toEqual([false, false, true]);
  });

  it("hides demo photos after the TTL, for everyone", () => {
    const old = {
      ...live,
      demoOnly: true,
      merchantIsPilot: false,
      uploadedAt: new Date(now.getTime() - DEMO_BATCH_PHOTO_TTL_MINUTES * 60_000),
    };
    expect(canViewBatchPhoto(old, demo, now)).toBe(false);
    expect(canViewBatchPhoto(old, owner, now)).toBe(false);
  });

  it("hides every photo once the batch is no longer live", () => {
    const pilot = { ...live, demoOnly: false, merchantIsPilot: true };
    expect(canViewBatchPhoto({ ...pilot, pickupEndTime: now }, owner, now)).toBe(false);
    expect(canViewBatchPhoto({ ...pilot, batchStatus: "CANCELLED" }, owner, now)).toBe(false);
    expect(canViewBatchPhoto({ ...pilot, batchStatus: "EXPIRED" }, anon, now)).toBe(false);
    expect(canViewBatchPhoto({ ...pilot, batchStatus: "SOLD_OUT" }, anon, now)).toBe(true);
    expect(canViewBatchPhoto({ ...pilot, batchStatus: "SCHEDULED" }, anon, now)).toBe(true);
  });

  it("builds the buyer meta from a discovery row", () => {
    expect(batchPhotoUrl("b1", "v1")).toBe("/api/v1/batches/b1/photo?v=v1");
    expect(
      batchPhotoFromRow({ batch_id: "b1", photo_id: "v1", photo_uploaded_at: "2026-11-14T12:45:00Z", photo_demo_only: true }),
    ).toEqual({ url: "/api/v1/batches/b1/photo?v=v1", uploaded_at: "2026-11-14T12:45:00.000Z", kind: "demo" });
    expect(batchPhotoFromRow({ batch_id: "b1", photo_id: null, photo_uploaded_at: null, photo_demo_only: null })).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Contracts and cart mapping                                          */
/* ------------------------------------------------------------------ */

describe("research contracts", () => {
  const menu = { menu_name: "Nasi Timbel", original_price_idr: 20000, min_recovery_price_idr: 10000 };

  it("requires listed contents for a new menu and refuses surprise items and repeats", () => {
    expect(MenuCreateBody.safeParse(menu).success).toBe(false);
    const ok = MenuCreateBody.parse({ ...menu, contents: ["  Nasi   timbel ", "Lalapan"], lauk_options: ["Ayam goreng"] });
    expect(ok.contents).toEqual(["Nasi timbel", "Lalapan"]);
    expect(MenuCreateBody.safeParse({ ...menu, lauk_options: ["Ayam goreng"] }).success).toBe(true);
    expect(MenuCreateBody.safeParse({ ...menu, contents: ["Roti"], category: "MYSTERY_BAG" }).success).toBe(false);
    expect(MenuCreateBody.safeParse({ ...menu, contents: ["Roti"], is_mystery_bag: true }).success).toBe(false);
    expect(MenuCreateBody.safeParse({ ...menu, contents: ["Lalapan", "lalapan"] }).success).toBe(false);
    expect(MenuCreateBody.safeParse({ ...menu, contents: ["x".repeat(41)] }).success).toBe(false);
    expect(MenuUpdateBody.safeParse({ is_active: false }).success).toBe(true);
    expect(MenuUpdateBody.safeParse({ category: "MYSTERY_BAG" }).success).toBe(false);
    expect(BUYER_MENU_CATEGORIES).not.toContain("MYSTERY_BAG");
  });

  it("keeps old publish and checkout bodies valid and adds the optional lauk fields", () => {
    const publish = PublishBody.parse({
      menu_id: "00000000-0000-4000-8000-000000000000",
      initial_stock: 5,
      pickup_end_time: "2026-11-14T15:00:00.000Z",
    });
    expect(publish.full_portion).toBe(true);
    expect(publish.lauk_available).toBeUndefined();
    const checkout = CheckoutBody.parse({
      merchant_id: "00000000-0000-4000-8000-000000000000",
      items: [
        { batch_id: "00000000-0000-4000-8000-000000000001", quantity: 1 },
        { batch_id: "00000000-0000-4000-8000-000000000001", quantity: 1, lauk: " Ayam  goreng " },
      ],
    });
    expect(checkout.items.map((i) => i.lauk)).toEqual([undefined, "Ayam goreng"]);
    expect(BatchPatchBody.safeParse({}).success).toBe(false);
    expect(BatchPatchBody.safeParse({ full_portion: false }).success).toBe(true);
  });

  it("needs a location to enable the hunger alert", () => {
    const base = { client_id: "device-123", webpush_subscription: { endpoint: "https://push.example/x", keys: { p256dh: "a", auth: "b" } } };
    expect(HungerAlertBody.safeParse({ ...base, enabled: true }).success).toBe(false);
    expect(HungerAlertBody.safeParse({ ...base, enabled: true, lat: -6.55, lng: 106.73 }).success).toBe(true);
    expect(HungerAlertBody.safeParse({ ...base, enabled: false }).success).toBe(true);
  });

  it("maps a batch to a cart line with the first available lauk preselected", () => {
    const batch = {
      batch_id: "b1",
      menu_id: "m1",
      menu_name: "Nasi Timbel + Lauk Pilihan",
      category: "MAKANAN_BERAT",
      lauk_available: ["Pepes ikan mas", "Ayam goreng"],
      selling_price_idr: 11000,
      original_price_idr: 22000,
      discount_pct: 50,
      available_stock: 4,
      portion_weight_grams: 300,
      pickup_end_time: "2026-11-14T15:00:00.000Z",
    } as BatchCard;
    expect(cartItemFromBatch(batch)).toMatchObject({ key: "b1|Pepes ikan mas", lauk: "Pepes ikan mas", quantity: 1, max_quantity: 4 });
    expect(cartItemFromBatch(batch, 2, null)).toMatchObject({ key: "b1|", lauk: null, quantity: 2 });
    expect(cartPatchFromBatch({ ...batch, lauk_available: ["Ayam goreng"] })).toEqual({
      unit_price_idr: 11000,
      discount_pct: 50,
      max_quantity: 4,
      lauk_available: ["Ayam goreng"],
    });
  });
});
