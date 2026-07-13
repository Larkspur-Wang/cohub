import assert from "node:assert/strict";
import { test } from "node:test";
import { createTalesofaiBillingOperations } from "../src/client.js";

const jsonResponse = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});

const activeBenefit = (input: {
	grantId: string;
	benefitKey: string;
	metadata: Record<string, string | number | boolean>;
}) => ({
	grant_id: input.grantId,
	benefit_id: `id:${input.benefitKey}`,
	benefit_key: input.benefitKey,
	benefit_name: input.benefitKey,
	benefit_type: "feature",
	config: { metadata: input.metadata },
	source_type: "subscription_paid_period",
	source_id: "period_1",
	granted_at: "2026-07-01T00:00:00.000Z",
	effective_at: "2026-07-01T00:00:00.000Z",
	expires_at: "2026-08-01T00:00:00.000Z",
});

test("billing operations resolves the best active model discount with one entitlement read", async () => {
	const originalFetch = globalThis.fetch;
	const requests: Array<{ method: string; url: URL }> = [];
	globalThis.fetch = async (input, init) => {
		const url = new URL(String(input));
		const method = init?.method ?? "GET";
		requests.push({ method, url });
		if (url.pathname === "/v1/customers" && method === "POST") {
			return jsonResponse({ customer: { external_user_id: "user_1" } });
		}
		if (url.pathname === "/v1/customers/user_1/entitlements" && method === "GET") {
			return jsonResponse({
				customer: { id: "customer_1", external_user_id: "user_1", status: "active", meta: {} },
				business_key: "cohub",
				active_benefits: [
					activeBenefit({
						grantId: "grant_pro",
						benefitKey: "pro_model_discount_v1",
						metadata: { "gpt-image-2": 0.6 },
					}),
					activeBenefit({
						grantId: "grant_max",
						benefitKey: "max_model_discount_v1",
						metadata: { "gpt-image-2": 0 },
					}),
				],
			});
		}
		throw new Error(`Unexpected request: ${method} ${url}`);
	};

	try {
		const operations = createTalesofaiBillingOperations({
			baseUrl: "https://billing.example.test/v1",
			businessKey: "cohub",
			adminApiKey: "test-key",
		});
		const discount = await operations.getGenerationModelDiscount({
			userId: "user_1",
			model: "gpt-image-2",
		});

		assert.equal(discount.multiplier, 0);
		assert.equal(discount.benefitKey, "max_model_discount_v1");
		assert.equal(discount.grantId, "grant_max");
		assert.equal(requests.filter(({ url }) => url.pathname.endsWith("/entitlements")).length, 1);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("billing operations treats missing metadata model keys as full price", async () => {
	const originalFetch = globalThis.fetch;
	const requests: Array<{ method: string; url: URL }> = [];
	globalThis.fetch = async (input, init) => {
		const url = new URL(String(input));
		const method = init?.method ?? "GET";
		requests.push({ method, url });
		if (url.pathname === "/v1/customers" && method === "POST") {
			return jsonResponse({ customer: { external_user_id: "user_1" } });
		}
		if (url.pathname === "/v1/customers/user_1/entitlements" && method === "GET") {
			return jsonResponse({
				customer: { id: "customer_1", external_user_id: "user_1", status: "active", meta: {} },
				business_key: "cohub",
				active_benefits: [
					activeBenefit({
						grantId: "grant_pro",
						benefitKey: "pro_model_discount_v1",
						metadata: { "gpt-image-2": 0.6 },
					}),
				],
			});
		}
		throw new Error(`Unexpected request: ${method} ${url}`);
	};

	try {
		const operations = createTalesofaiBillingOperations({
			baseUrl: "https://billing.example.test/v1",
			businessKey: "cohub",
			adminApiKey: "test-key",
		});
		const discount = await operations.getGenerationModelDiscount({
			userId: "user_1",
			model: "gemini-3.1-flash-lite-image",
		});
		assert.equal(discount.multiplier, 1);
		assert.equal(discount.benefitKey, null);
		assert.equal(requests.filter(({ url }) => url.pathname.endsWith("/entitlements")).length, 1);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("billing operations propagates entitlement lookup failures instead of charging full price", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (input, init) => {
		const url = new URL(String(input));
		if (url.pathname === "/v1/customers" && init?.method === "POST") {
			return jsonResponse({ customer: { external_user_id: "user_1" } });
		}
		if (url.pathname === "/v1/customers/user_1/entitlements") {
			return jsonResponse({ message: "Business not found" }, 404);
		}
		throw new Error(`Unexpected request: ${String(input)}`);
	};

	try {
		const operations = createTalesofaiBillingOperations({
			baseUrl: "https://billing.example.test/v1",
			businessKey: "missing-business",
			adminApiKey: "test-key",
		});
		await assert.rejects(
			operations.getGenerationModelDiscount({ userId: "user_1", model: "gpt-image-2" }),
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
