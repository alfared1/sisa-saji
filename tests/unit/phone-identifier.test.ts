import { describe, expect, it } from "vitest";
import { phoneNumberSchema } from "@/lib/contracts";
import {
  abbreviateName,
  normalizeEmail,
  normalizePhone,
  toLoginIdentifier,
} from "@/server/services/auth/identifier";

describe("normalizePhone", () => {
  it.each([
    ["081234567890", "+6281234567890"],
    ["6281234567890", "+6281234567890"],
    ["+6281234567890", "+6281234567890"],
    [" 0812-3456 7890 ", "+6281234567890"],
    ["(0812) 3456.7890", "+6281234567890"],
  ])("%s → %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it("all accepted contract formats normalise to the same identifier", () => {
    const forms = ["081234567890", "6281234567890", "+6281234567890"];
    for (const f of forms) expect(phoneNumberSchema.safeParse(f).success).toBe(true);
    expect(new Set(forms.map(normalizePhone)).size).toBe(1);
  });

  it("the contract rejects non-Indonesian mobile numbers", () => {
    expect(phoneNumberSchema.safeParse("0212345678").success).toBe(false);
    expect(phoneNumberSchema.safeParse("+14155550100").success).toBe(false);
  });
});

describe("normalizeEmail / toLoginIdentifier", () => {
  it("lower-cases and trims emails", () => {
    expect(normalizeEmail("  Raka.P@Mail.TEST ")).toBe("raka.p@mail.test");
  });

  it("maps phone → WHATSAPP and email → EMAIL", () => {
    expect(toLoginIdentifier({ phone_number: "08123456789" })).toEqual({
      kind: "phone",
      value: "+628123456789",
      channel: "WHATSAPP",
    });
    expect(toLoginIdentifier({ email: "A@B.TEST" })).toEqual({ kind: "email", value: "a@b.test", channel: "EMAIL" });
  });

  it("throws without an identifier", () => {
    expect(() => toLoginIdentifier({})).toThrow();
  });
});

describe("abbreviateName", () => {
  it("first name + initial of the second", () => {
    expect(abbreviateName("Raka Pratama")).toBe("Raka P.");
    expect(abbreviateName("  siti   nur aini ")).toBe("siti N.");
  });
  it("single names and empty strings", () => {
    expect(abbreviateName("Bejo")).toBe("Bejo");
    expect(abbreviateName("   ")).toBe("Pengguna");
  });
});
