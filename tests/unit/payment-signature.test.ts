import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  newGatewayRef,
  signWebhookBody,
  verifyWebhookSignature,
} from "@/server/services/payment/webhook";

const SECRET = "unit-test-webhook-secret-0123456789abcdef";
const body = JSON.stringify({
  order_id: "3f2b8c1e-7a6d-4e2f-9b1a-0c5d6e7f8a9b",
  gateway_ref: "SIM-ABC",
  status: "PAID",
  amount_idr: 12500,
});

describe("webhook signature (hex HMAC-SHA512 of the raw body)", () => {
  it("signs exactly like a gateway would", () => {
    const expected = createHmac("sha512", SECRET).update(body).digest("hex");
    expect(signWebhookBody(body, SECRET)).toBe(expected);
    expect(expected).toHaveLength(128);
  });

  it("accepts a valid signature (case-insensitive hex, surrounding whitespace)", () => {
    const sig = signWebhookBody(body, SECRET);
    expect(verifyWebhookSignature(body, sig, SECRET)).toBe(true);
    expect(verifyWebhookSignature(body, ` ${sig.toUpperCase()} `, SECRET)).toBe(true);
  });

  it("rejects missing, malformed, wrong-secret and tampered-body signatures", () => {
    const sig = signWebhookBody(body, SECRET);
    expect(verifyWebhookSignature(body, null, SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, "", SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, "zz", SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, sig.slice(0, 64), SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, signWebhookBody(body, "another-secret"), SECRET)).toBe(false);
    expect(verifyWebhookSignature(body.replace("12500", "100"), sig, SECRET)).toBe(false);
  });
});

describe("newGatewayRef", () => {
  it("is a unique SIM- reference", () => {
    const a = newGatewayRef();
    expect(a).toMatch(/^SIM-[0-9A-F]{16}$/);
    expect(newGatewayRef()).not.toBe(a);
  });
});
