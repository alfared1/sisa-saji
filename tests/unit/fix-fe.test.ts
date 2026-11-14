import { beforeEach, describe, expect, it } from "vitest";
import { formatCountdownText } from "@/components/common/countdown-format";
import { retrySession } from "@/hooks/use-session";
import { LAST_EVENT_ID_PARAM, withLastEventId } from "@/hooks/use-event-source";
import { ApiClientError } from "@/lib/api/client";
import type { OrderDetail } from "@/lib/contracts";
import { isPrivateCacheName, serviceWorkerUrl } from "@/lib/pwa/sw";
import { useTicketsStore } from "@/stores/tickets";

describe("formatCountdownText (countdown reads as a duration)", () => {
  it("shows hours, minutes and seconds after a duration prefix", () => {
    expect(formatCountdownText({ hours: 0, minutes: 15, seconds: 28 }, "Tutup dalam")).toBe("Tutup dalam 00:15:28");
    expect(formatCountdownText({ hours: 1, minutes: 4, seconds: 22 }, "Tutup dalam")).toBe("Tutup dalam 01:04:22");
  });
  it("works with the other duration prefixes", () => {
    expect(formatCountdownText({ hours: 0, minutes: 28, seconds: 12 }, "Ambil dalam")).toBe("Ambil dalam 00:28:12");
  });
  it("pads every part and adds no leading space without a prefix", () => {
    expect(formatCountdownText({ hours: 0, minutes: 0, seconds: 7 }, "")).toBe("00:00:07");
  });
});

describe("tickets owner scoping (offline-tickets-survive-logout)", () => {
  const order = (id: string) =>
    ({ id, status: "READY_FOR_PICKUP", pickup_deadline_at: "2099-01-01T00:00:00.000Z" }) as OrderDetail;

  beforeEach(() => useTicketsStore.setState({ tickets: {}, owner_user_id: null }));

  it("binds the first confirmed user and keeps their tickets", () => {
    useTicketsStore.getState().reconcileOwner("u1");
    useTicketsStore.getState().syncOrder(order("o1"));
    useTicketsStore.getState().reconcileOwner("u1");
    expect(Object.keys(useTicketsStore.getState().tickets)).toEqual(["o1"]);
  });

  it("wipes tickets when another user signs in on the same device", () => {
    useTicketsStore.getState().reconcileOwner("u1");
    useTicketsStore.getState().syncOrder(order("o1"));
    useTicketsStore.getState().reconcileOwner("u2");
    expect(useTicketsStore.getState().tickets).toEqual({});
    expect(useTicketsStore.getState().owner_user_id).toBe("u2");
  });

  it("wipes tickets once the server confirms there is no session", () => {
    useTicketsStore.getState().reconcileOwner("u1");
    useTicketsStore.getState().syncOrder(order("o1"));
    useTicketsStore.getState().reconcileOwner(null);
    expect(useTicketsStore.getState().tickets).toEqual({});
    expect(useTicketsStore.getState().owner_user_id).toBeNull();
  });

  it("wipes legacy tickets saved without an owner", () => {
    useTicketsStore.setState({ tickets: { o1: { order: order("o1"), saved_at: "x" } }, owner_user_id: null });
    useTicketsStore.getState().reconcileOwner("u9");
    expect(useTicketsStore.getState().tickets).toEqual({});
  });

  it("clear() also forgets the owner", () => {
    useTicketsStore.getState().reconcileOwner("u1");
    useTicketsStore.getState().clear();
    expect(useTicketsStore.getState().owner_user_id).toBeNull();
  });
});

describe("SW private caches (logout-keeps-sw-ticket-cache)", () => {
  it("marks ticket and page caches as private, never static/shell", () => {
    expect(isPrivateCacheName("ss-tickets-v1")).toBe(true);
    expect(isPrivateCacheName("ss-pages-v1-abc")).toBe(true);
    expect(isPrivateCacheName("ss-static-v1")).toBe(false);
    expect(isPrivateCacheName("ss-shell-v1")).toBe(false);
  });
  it("versions the worker URL per build (sw-static-cache-unbounded)", () => {
    expect(serviceWorkerUrl("lx9k2")).toBe("/sw.js?v=lx9k2");
    expect(serviceWorkerUrl("")).toBe("/sw.js");
  });
});

describe("withLastEventId (eventsource-reconnect-loses-last-event-id)", () => {
  it("leaves the url alone before any event", () => {
    expect(withLastEventId("/api/v1/stream/merchant", null)).toBe("/api/v1/stream/merchant");
  });
  it("appends or replaces last_event_id, keeping other params", () => {
    const u = withLastEventId("/api/v1/stream/batches?lat=-7.7&lng=110.3", "2026-11-09 13:00:00.123+00");
    const params = new URLSearchParams(u.split("?")[1]);
    expect(params.get("lat")).toBe("-7.7");
    expect(params.get(LAST_EVENT_ID_PARAM)).toBe("2026-11-09 13:00:00.123+00");
    const again = withLastEventId(u, "42");
    expect(new URLSearchParams(again.split("?")[1]).getAll(LAST_EVENT_ID_PARAM)).toEqual(["42"]);
  });
});

describe("retrySession (offline-cold-start-hides-ticket)", () => {
  it("does not retry /auth/me while offline", () => {
    expect(retrySession(0, new ApiClientError("NETWORK_ERROR", "offline", 0))).toBe(false);
  });
  it("still retries server errors a couple of times", () => {
    expect(retrySession(0, new ApiClientError("INTERNAL_ERROR", "boom", 500))).toBe(true);
    expect(retrySession(2, new ApiClientError("INTERNAL_ERROR", "boom", 500))).toBe(false);
  });
});
