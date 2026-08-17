import assert from "node:assert/strict";
import { test } from "node:test";
import { WorksApi } from "../src/apis/works.js";
import type { HttpTransport } from "../src/transport.js";

test("WorksApi.getStats requests the fixed analytics range", async () => {
  const transport = {
    request: async (path: string) => {
      assert.equal(path, "/api/works/work-1/stats");
      return {};
    },
  } as unknown as HttpTransport;

  await new WorksApi(transport).getStats("work-1");
});

test("WorksApi creates and records Work promotions", async () => {
  const requests: Array<{ path: string; init?: RequestInit }> = [];
  const transport = {
    request: async (path: string, init?: RequestInit) => {
      requests.push({ path, init });
      return {};
    },
  } as unknown as HttpTransport;
  const api = new WorksApi(transport);

  await api.createPromotion("work-1", {
    name: "Launch",
    provider: "generic",
    parameters: { utm_source: "newsletter" },
  });
  await api.recordPromotionEvent("work-1", "promotion-1", {
    eventKey: "ready",
    eventId: "event-1",
  });
  await api.recordPromotionRegistration("work-1", "promotion-1", {
    fbp: "fbp-1",
  });

  assert.equal(requests[0]?.path, "/api/works/work-1/promotions");
  assert.equal(requests[0]?.init?.method, "POST");
  assert.equal(requests[1]?.path, "/api/works/work-1/promotions/promotion-1/events");
  assert.equal(requests[1]?.init?.method, "POST");
  assert.equal(requests[2]?.path, "/api/works/work-1/promotions/promotion-1/registration");
  assert.equal(requests[2]?.init?.method, "POST");
});

test("WorksApi.getBySlug forwards the abort signal", async () => {
  const controller = new AbortController();
  const transport = {
    request: async (path: string, init?: RequestInit) => {
      assert.equal(path, "/api/works/by-slug/alice/studio/launch");
      assert.equal(init?.signal, controller.signal);
      return {};
    },
  } as unknown as HttpTransport;

  await new WorksApi(transport).getBySlug("alice", "studio", "launch", {
    signal: controller.signal,
  });
});
