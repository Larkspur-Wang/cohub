import type { PromptTemplateCatalogEntry } from "@neta-art/cohub";

const CACHE_VERSION = 2;

function getCacheKey(spaceId: string) {
	return `cohub:space-prompt-templates:${spaceId}:v${CACHE_VERSION}`;
}

function isPromptTemplate(value: unknown): value is PromptTemplateCatalogEntry {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return (
		typeof record.name === "string" &&
		typeof record.description === "string" &&
		(record.argumentHint === undefined ||
			typeof record.argumentHint === "string") &&
		(record.category === undefined || typeof record.category === "string") &&
		(record.scope === "platform" ||
			record.scope === "mod" ||
			record.scope === "user" ||
			record.scope === "project")
	);
}

export function readCachedPromptTemplates(spaceId: string) {
	if (typeof localStorage === "undefined") return null;
	try {
		const raw = localStorage.getItem(getCacheKey(spaceId));
		if (!raw) return null;
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object") return null;
		const record = parsed as Record<string, unknown>;
		if (record.version !== CACHE_VERSION || !Array.isArray(record.prompts)) {
			return null;
		}
		if (!record.prompts.every(isPromptTemplate)) return null;
		return record.prompts;
	} catch {
		return null;
	}
}

export function writeCachedPromptTemplates(
	spaceId: string,
	prompts: PromptTemplateCatalogEntry[],
) {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(
			getCacheKey(spaceId),
			JSON.stringify({ version: CACHE_VERSION, prompts }),
		);
	} catch {
		// Cache writes are best-effort and should never block workspace boot.
	}
}
