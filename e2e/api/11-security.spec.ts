import { randomUUID } from "node:crypto";
import { request as pwRequest } from "@playwright/test";
import { expect, test } from "../fixtures";
import { DEMO_MERCHANT_EMAIL, E2E_BASE_URL } from "../env";
import { createPaidOrder, errorCode, pickBatch, registerCustomer, sessionTokenFor } from "../helpers";

/** A minimal JPEG: SOI, a 640 × 480 SOF0 frame, SOS, EOI. */
function tinyJpeg(): Buffer {
  const frame = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const sos = [0xff, 0xda, 0x00, 0x0c, 0x03, 1, 0, 2, 0x11, 3, 0x11, 0x00, 0x3f, 0x00, 0x12, 0x34, 0xff, 0xd9];
  return Buffer.from([0xff, 0xd8, ...frame, ...sos]);
}

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

  test("batch photo upload takes real JPEG bytes only, up to 400 KB, from merchants only", async () => {
    const merchant = await pwRequest.newContext({
      baseURL: E2E_BASE_URL,
      extraHTTPHeaders: { cookie: `ss_session=${await sessionTokenFor(DEMO_MERCHANT_EMAIL)}` },
    });
    // The body is checked before the batch is looked up, so an unknown batch id is enough:
    // nothing is stored and no upload is counted against the warung's limits.
    const url = `/api/v1/merchant/surplus/${randomUUID()}/photo`;
    const post = (ctx: typeof merchant, body: Buffer) => ctx.post(url, { headers: { "content-type": "image/jpeg" }, data: body });

    const fakes = {
      png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]),
      svg: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      html: Buffer.from("<!doctype html><title>x</title>"),
    };
    for (const [name, body] of Object.entries(fakes)) {
      const res = await post(merchant, body);
      expect(res.status(), name).toBe(415);
      expect(await errorCode(res)).toBe("VALIDATION_ERROR");
    }
    // A real JPEG passes the body checks and stops at the ownership check.
    const unknown = await post(merchant, tinyJpeg());
    expect(unknown.status()).toBe(404);
    expect(await errorCode(unknown)).toBe("NOT_FOUND");
    // The declared length is refused before the body is read, so the server drops that
    // connection afterwards. Use a context of its own so no later request reuses the socket.
    const bigSender = await pwRequest.newContext({
      baseURL: E2E_BASE_URL,
      extraHTTPHeaders: { cookie: `ss_session=${await sessionTokenFor(DEMO_MERCHANT_EMAIL)}` },
    });
    const tooLarge = await post(bigSender, Buffer.concat([tinyJpeg(), Buffer.alloc(400 * 1024, 0x41)]));
    expect(tooLarge.status()).toBe(413);
    await bigSender.dispose();

    const customer = await pwRequest.newContext({ baseURL: E2E_BASE_URL });
    await registerCustomer(customer, "Pembeli Foto");
    expect((await post(customer, tinyJpeg())).status()).toBe(403);
    const anonymous = await pwRequest.newContext({ baseURL: E2E_BASE_URL });
    expect((await post(anonymous, tinyJpeg())).status()).toBe(401);
    await Promise.all([merchant.dispose(), customer.dispose(), anonymous.dispose()]);
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
