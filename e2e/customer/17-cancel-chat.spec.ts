import { request as pwRequest } from "@playwright/test";
import { expect, test } from "../fixtures";
import { DEMO_MERCHANT_EMAIL, DEMO_MERCHANT_SLUG, E2E_BASE_URL } from "../env";
import { createPaidOrder, ok, pickBatch, sessionTokenFor } from "../helpers";
import type { OrderMessagesResponse, OrderResponse } from "../../src/lib/contracts";

/**
 * Paid ticket: the buyer chats with the warung in the app, then asks to cancel; the warung
 * answers in the chat and approves; the buyer's page shows the refund.
 */
test("buyer chats with the warung and gets a refund after the warung approves a cancel request", async ({ page }) => {
  const batch = await pickBatch(page.request, { merchantSlug: DEMO_MERCHANT_SLUG });
  const order = await createPaidOrder(page.request, batch);
  const warung = await pwRequest.newContext({
    baseURL: E2E_BASE_URL,
    extraHTTPHeaders: { cookie: `ss_session=${await sessionTokenFor(DEMO_MERCHANT_EMAIL)}` },
  });

  await page.goto(`/orders/${order.id}`);
  await expect(page.getByText(/^SJ-\d{4}$/)).toBeVisible();

  // Chat: a quick reply from the buyer, a typed answer from the warung.
  await page.getByRole("button", { name: /Chat Warung/ }).click();
  const chat = page.getByRole("dialog");
  await expect(chat.getByText("Belum ada pesan.", { exact: false })).toBeVisible();
  await chat.getByRole("group", { name: "Balasan cepat" }).getByRole("button", { name: "Saya sedang di jalan" }).click();
  await expect(chat.getByText("Saya sedang di jalan", { exact: true }).last()).toBeVisible();

  const seen = await ok<OrderMessagesResponse>(await warung.get(`/api/v1/orders/${order.id}/messages?as=merchant`));
  expect(seen.messages.map((m) => m.body)).toEqual(["Saya sedang di jalan"]);
  expect((await warung.post(`/api/v1/orders/${order.id}/messages`, { data: { body: "Ditunggu ya", as: "merchant" } })).status()).toBe(201);
  await expect(chat.getByText("Ditunggu ya")).toBeVisible();
  // The buyer's message was read by the warung.
  await expect(chat.getByText(/Dibaca/)).toBeVisible();
  await page.keyboard.press("Escape");

  // Cancel request with a reason.
  await page.getByRole("button", { name: "Minta batal" }).click();
  const ask = page.getByRole("dialog", { name: "Minta batal pesanan?" });
  await ask.getByLabel("Salah pesan").check();
  await ask.getByRole("button", { name: "Kirim" }).click();
  await expect(page.getByText("Menunggu jawaban warung")).toBeVisible();

  const approved = await ok<OrderResponse>(
    await warung.post(`/api/v1/merchant/orders/${order.id}/cancel-request`, { data: { decision: "APPROVE" } }),
  );
  expect(approved.order.status).toBe("CANCELLED");

  // The ticket page polls and turns into the refund view.
  await expect(page.getByText("Dana dikembalikan")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/^Ke metode pembayaranmu · RFD-/)).toBeVisible();
  await warung.dispose();
});
