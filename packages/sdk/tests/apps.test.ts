import assert from "node:assert/strict";
import { test } from "node:test";
import { AppsApi, CohubClient } from "@neta-art/cohub";
import type { AppRecord, AppVersionRecord } from "@neta-art/cohub";
import type { HttpTransport } from "../src/transport.js";

test("AppsApi.getStats requests the fixed analytics range", async () => {
  const transport = {
    request: async (path: string) => {
      assert.equal(path, "/api/works/work-1/stats");
      return {};
    },
  } as unknown as HttpTransport;

  await new AppsApi(transport).getStats("work-1");
});

test("AppsApi creates and records Work promotions", async () => {
  const requests: Array<{ path: string; init?: RequestInit }> = [];
  const transport = {
    request: async (path: string, init?: RequestInit) => {
      requests.push({ path, init });
      return {};
    },
  } as unknown as HttpTransport;
  const api = new AppsApi(transport);

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

test("AppsApi.getBySlug forwards the abort signal", async () => {
  const controller = new AbortController();
  const transport = {
    request: async (path: string, init?: RequestInit) => {
      assert.equal(path, "/api/works/by-slug/alice/studio/launch");
      assert.equal(init?.signal, controller.signal);
      return {};
    },
  } as unknown as HttpTransport;

  await new AppsApi(transport).getBySlug("alice", "studio", "launch", {
    signal: controller.signal,
  });
});

test("works REST wire field names stay frozen for existing API consumers", () => {
	// External consumers (e.g. neta-studio) call `/api/works*` directly and
	// read these exact field names. Renaming any of them is a breaking wire
	// change reserved for the next protocol version.
	const record: AppRecord = {
		id: "app-1",
		spaceId: "space-1",
		userUuid: "user-1",
		slug: "launch",
		status: "published",
		visibility: "public",
		targetType: "directory",
		targetRef: "dist",
		assetKey: "w/space-1/launch/abc/index.html",
		currentVersionId: "v-1",
		latestVersion: 1,
		publishedAt: null,
		workScopes: ["space.view"],
		allowedViewerScopes: [],
		meta: null,
		createdAt: null,
		updatedAt: null,
	};
	assert.deepEqual(Object.keys(record).sort(), [
		"allowedViewerScopes",
		"assetKey",
		"createdAt",
		"currentVersionId",
		"id",
		"latestVersion",
		"meta",
		"publishedAt",
		"slug",
		"spaceId",
		"status",
		"targetRef",
		"targetType",
		"updatedAt",
		"userUuid",
		"visibility",
		"workScopes",
	]);

	const version: AppVersionRecord = {
		id: "v-1",
		workId: "app-1",
		version: 1,
		targetType: "directory",
		targetRef: "dist",
		assetKey: null,
		contentKind: "web",
		artifact: null,
		meta: null,
		createdAt: null,
	};
	assert.ok("workId" in version, "version records keep the frozen workId field");
});

test("client.apps and client.works point at the same API instance", () => {
	const client = new CohubClient({ getAccessToken: async () => null });
	assert.equal(client.apps, client.works);
	assert.equal(client.desktop, client.ui);
	assert.equal(client.appCommerce, client.workCommerce);
});
