import { describe, expect, it } from "vitest";
import {
  buildDynamicQris,
  cityFromAddress,
  crc16CcittFalse,
  hasValidQrisCrc,
  parseTlv,
  tlv,
} from "@/server/services/payment/qris";

const input = {
  merchantName: "Warung Makan Bu Sri",
  merchantCity: "Sleman",
  merchantRef: "3f2b8c1e-7a6d-4e2f-9b1a-0c5d6e7f8a9b",
  amountIdr: 12500,
  reference: "SS-20261108-0007",
};

describe("crc16CcittFalse", () => {
  it("matches the standard check value (\"123456789\" → 29B1)", () => {
    expect(crc16CcittFalse("123456789")).toBe("29B1");
  });
  it("is 4 upper-case hex digits, zero padded", () => {
    expect(crc16CcittFalse("")).toBe("FFFF");
    expect(crc16CcittFalse("A")).toMatch(/^[0-9A-F]{4}$/);
  });
});

describe("tlv", () => {
  it("encodes tag + 2-digit length + value", () => {
    expect(tlv("54", "12500")).toBe("540512500");
  });
  it("rejects bad tags and values over 99 chars", () => {
    expect(() => tlv("5", "x")).toThrow();
    expect(() => tlv("59", "x".repeat(100))).toThrow();
  });
});

describe("buildDynamicQris", () => {
  const payload = buildDynamicQris(input);
  const fields = parseTlv(payload);

  it("is a dynamic EMVCo payload (00=01, 01=12) in IDR for Indonesia", () => {
    expect(payload.startsWith("000201010212")).toBe(true);
    expect(fields.get("53")).toBe("360");
    expect(fields.get("58")).toBe("ID");
  });

  it("carries the amount in tag 54, merchant name in 59 and the reference in 62", () => {
    expect(fields.get("54")).toBe("12500");
    expect(fields.get("59")).toBe("Warung Makan Bu Sri");
    expect(fields.get("60")).toBe("SLEMAN");
    const additional = parseTlv(fields.get("62")!);
    expect(additional.get("01")).toBe(input.reference);
    expect(additional.get("05")).toBe(input.reference);
  });

  it("nested merchant account templates parse cleanly", () => {
    expect(parseTlv(fields.get("26")!).get("00")).toBe("ID.CO.SISASAJI.WWW");
    expect(parseTlv(fields.get("51")!).get("00")).toBe("ID.CO.QRIS.WWW");
  });

  it("ends with tag 63 holding a correct CRC over everything before it", () => {
    expect(payload.slice(-8, -4)).toBe("6304");
    expect(fields.get("63")).toBe(crc16CcittFalse(payload.slice(0, -4)));
    expect(hasValidQrisCrc(payload)).toBe(true);
  });

  it("detects tampering (changed amount breaks the CRC)", () => {
    const tampered = payload.replace("540512500", "540519900");
    expect(tampered).not.toBe(payload);
    expect(hasValidQrisCrc(tampered)).toBe(false);
  });

  it("strips non-ASCII and truncates long merchant names to 25 chars", () => {
    const p = buildDynamicQris({ ...input, merchantName: "Wàrung Énak Sekali Banget Pokoknya Mantap" });
    const name = parseTlv(p).get("59")!;
    expect(name.length).toBeLessThanOrEqual(25);
    expect(name).toMatch(/^[\x20-\x7E]+$/);
    expect(hasValidQrisCrc(p)).toBe(true);
  });

  it("rejects non-positive or fractional amounts", () => {
    expect(() => buildDynamicQris({ ...input, amountIdr: 0 })).toThrow();
    expect(() => buildDynamicQris({ ...input, amountIdr: 10.5 })).toThrow();
  });
});

describe("cityFromAddress", () => {
  it("takes the last comma-separated part", () => {
    expect(cityFromAddress("Pogung Kidul, Sinduadi, Mlati, Sleman")).toBe("Sleman");
    expect(cityFromAddress("")).toBe("INDONESIA");
  });
});
