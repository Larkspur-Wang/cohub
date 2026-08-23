import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isLocalePreference, resolvePreferredLocale } from "$lib/i18n/locale";
import { m } from "$lib/paraglide/messages.js";
import { setLocale } from "$lib/paraglide/runtime.js";

test("English and Chinese catalogs contain the same messages", async () => {
	const [englishSource, chineseSource] = await Promise.all([
		readFile(new URL("../../messages/en.json", import.meta.url), "utf8"),
		readFile(new URL("../../messages/zh-CN.json", import.meta.url), "utf8"),
	]);
	const english = JSON.parse(englishSource) as Record<string, string>;
	const chinese = JSON.parse(chineseSource) as Record<string, string>;

	assert.deepEqual(Object.keys(chinese).sort(), Object.keys(english).sort());
	assert.equal(
		Object.values(chinese).every((message) => message.length > 0),
		true,
	);
});

test("Paraglide runtime follows locale changes without per-message options", () => {
	setLocale("zh-CN", { reload: false });
	assert.equal(m.common_save(), "保存");
	setLocale("en", { reload: false });
	assert.equal(m.common_save(), "Save");
});

test("locale preferences accept only supported values", () => {
	assert.equal(isLocalePreference("system"), true);
	assert.equal(isLocalePreference("en"), true);
	assert.equal(isLocalePreference("zh-CN"), true);
	assert.equal(isLocalePreference("zh"), false);
	assert.equal(isLocalePreference(null), false);
});

test("explicit locale takes precedence over browser languages", () => {
	assert.equal(resolvePreferredLocale("en", ["zh-CN"]), "en");
	assert.equal(resolvePreferredLocale("zh-CN", ["en-US"]), "zh-CN");
});

test("system locale selects the first supported browser language", () => {
	assert.equal(resolvePreferredLocale("system", ["en-US", "zh-CN"]), "en");
	assert.equal(
		resolvePreferredLocale("system", ["ja-JP", "zh-Hant-TW", "en-US"]),
		"zh-CN",
	);
	assert.equal(resolvePreferredLocale("system", ["ja-JP", "en-US"]), "en");
	assert.equal(resolvePreferredLocale("system", []), "en");
});
