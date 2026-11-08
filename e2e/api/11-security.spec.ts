import { request as pwRequest } from "@playwright/test";
import { expect, test } from "../fixtures";
import { E2E_BASE_URL } from "../env";
import { createPaidOrder, errorCode, pickBatch, registerCustomer } from "../helpers";

test.describe("security smoke", () => {
  test("a customer cannot read another customer's order (404)", async () => {
    const alice = await pwRequest.newContext({ baseURL: E2E_BASE_URL });
    const bob = await pwRequest.newContext({ baseURL: E2E_BASE_URL });
    const order = await createPaidOrder(alice, await pickBatch(alice));
    expect((await alice.get(`/api/v1/orders/${order.id}`)).status()).toBe(200);

    await registerCustomer(bob, "Bob Penyusup");
    const res = await bob.get(`/api/v1/orders/${order.id}`);
    expect(res.status()).toBe(404);
    expect(await errorCode(res)).toBe("NOT_FOUND");
    // Nor act on it.
    expect((await bob.post(`/api/v1/orders/${order.id}/cancel`)).status()).toBe(404);
    await Promise.all([alice.dispose(), bob.dispose()]);
  });

  test("a customer cannot call merchant endpoints (403)", async () => {
    const customer = await pwRequest.newContext({ baseURL: E2E_BASE_URL });
    await registerCustomer(customer, "Pembeli Biasa");
    for (const res of [
      await customer.get("/api/v1/merchant/dashboard"),
      await customer.post("/api/v1/orders/lookup-pickup", { data: { pickup_code_or_qr_token: "1234" } }),
    ]) {
      expect(res.status(), res.url()).toBe(403);
    }
    await customer.dispose();
  });

  test("anonymous requests to protected endpoints are 401", async ({ request }) => {
    expect((await request.get("/api/v1/orders")).status()).toBe(401);
    expect((await request.get("/api/v1/merchant/dashboard")).status()).toBe(401);
  });

  test("payment webhook with a bad signature is rejected (401)", async ({ request }) => {
    const res = await request.post("/api/v1/webhooks/payment", {
      headers: { "x-signature": "deadbeef".repeat(16) },
      data: {
        order_id: "00000000-0000-4000-8000-000000000000",
        gateway_ref: "forged",
        status: "PAID",
        amount_idr: 1,
      },
    });
    expect(res.status()).toBe(401);
    expect(await errorCode(res)).toBe("INVALID_SIGNATURE");
  });
});
