import assert from "node:assert/strict";
import { test } from "node:test";
import { formatCurrency, formatDate, formatDateTime } from "../lib/i18n/format";

test("formatCurrency follows currency rules, not just symbol swap", () => {
	// Locale governs symbol + placement + sign; precision tiers are preserved.
	assert.equal(formatCurrency(0.0004, "USD", { locale: "en" }), "$0.0004");
	assert.equal(formatCurrency(0.0004, "USD", { locale: "zh-CN" }), "US$0.0004");
	assert.equal(formatCurrency(1.234, "USD", { locale: "en" }), "$1.23");
	assert.equal(formatCurrency(0, "USD", { locale: "en" }), "$0.00");
	assert.equal(formatCurrency(-5, "USD", { locale: "en" }), "-$5.00");
	assert.equal(formatCurrency(12.5, "CNY", { locale: "zh-CN" }), "¥12.50");
});

test("formatCurrency normalizes one-sided and inverted precision bounds", () => {
	// Only min: never produce max < min (RangeError regression).
	assert.equal(
		formatCurrency(1.5, "USD", { locale: "en", minimumFractionDigits: 4 }),
		"$1.5000",
	);
	// Only max: show as few decimals as needed up to max.
	assert.equal(
		formatCurrency(0.0004, "USD", { locale: "en", maximumFractionDigits: 4 }),
		"$0.0004",
	);
	// Explicitly inverted bounds are clamped to a valid range.
	assert.equal(
		formatCurrency(1, "USD", {
			locale: "en",
			minimumFractionDigits: 4,
			maximumFractionDigits: 2,
		}),
		"$1.0000",
	);
});

test("formatDate / formatDateTime are locale aware", () => {
	const value = new Date("2026-08-23T14:22:00");
	assert.ok(formatDate(value, "en").includes("2026"));
	assert.ok(formatDate(value, "zh-CN").includes("2026"));
	assert.ok(formatDateTime(value, "en").includes("2026"));
	assert.ok(formatDateTime(value, "zh-CN").includes("2026"));
});

test("formatDateTime accepts dateStyle/timeStyle without throwing", () => {
	const value = new Date("2026-08-23T14:22:00");
	// `Intl` forbids mixing style-based options with concrete fields; the
	// defaults must be dropped when a caller opts into styles (regression).
	const styled = formatDateTime(value, "en", {
		dateStyle: "medium",
		timeStyle: "short",
	});
	assert.ok(styled.includes("2026"));
	assert.ok(styled.includes("2:22 PM"));
	const styledZh = formatDateTime(value, "zh-CN", {
		dateStyle: "medium",
		timeStyle: "short",
	});
	assert.ok(styledZh.includes("2026"));
});

test("formatters are non-reactive and default to deterministic en", () => {
	// When no locale is supplied, output is stable English (baseLocale) — a
	// component that has not read a reactive `getLocale()` must not silently
	// follow the runtime global. Callers opt into localization by passing the
	// reactive locale, which is also what makes them re-render on change.
	assert.equal(formatCurrency(0.0123, "USD"), "$0.012");
	assert.equal(
		formatDateTime(new Date("2026-08-23T14:22:00")),
		"Aug 23, 2026, 02:22 PM",
	);
});
