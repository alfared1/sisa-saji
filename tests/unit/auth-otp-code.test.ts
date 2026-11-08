import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { OtpRequestBody, OtpVerifyBody } from "@/lib/contracts";
import { generateOtpCode, hashOtp } from "@/server/services/auth/otp";
import { otpMessageText } from "@/server/services/auth/otp-delivery";

describe("OTP code", () => {
  it("is always 6 digits (zero padded)", () => {
    for (let i = 0; i < 500; i++) expect(generateOtpCode()).toMatch(/^\d{6}$/);
  });

  it("stores only sha256(identifier:code)", () => {
    const h = hashOtp("+6281234567890", "012345");
    expect(h).toBe(createHash("sha256").update("+6281234567890:012345").digest("hex"));
    expect(h).not.toContain("012345");
    // Same code for a different identifier hashes differently.
    expect(hashOtp("+6281234567891", "012345")).not.toBe(h);
  });

  it("Indonesian message mentions the code and validity in minutes", () => {
    expect(otpMessageText("123456", 300)).toContain("123456");
    expect(otpMessageText("123456", 300)).toContain("5 menit");
  });
});

describe("OTP contract validation", () => {
  it("needs exactly one identifier", () => {
    expect(OtpRequestBody.safeParse({}).success).toBe(false);
    expect(OtpRequestBody.safeParse({ phone_number: "081234567890", email: "a@b.test" }).success).toBe(false);
    expect(OtpRequestBody.parse({ email: " A@B.TEST " })).toEqual({ email: "a@b.test", role: "CUSTOMER" });
  });
  it("verify needs a 6-digit code", () => {
    expect(OtpVerifyBody.safeParse({ email: "a@b.test", code: "12345" }).success).toBe(false);
    expect(OtpVerifyBody.safeParse({ email: "a@b.test", code: "123456" }).success).toBe(true);
  });
});
