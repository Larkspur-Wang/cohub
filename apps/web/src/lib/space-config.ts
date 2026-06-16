import { SPACE_CONFIG_PATH } from "@cohub/protocol";
import { HttpError } from "@neta-art/cohub";
import { sdk } from "$lib/sdk";

export type NewChatBackgroundConfig = {
	type: "html" | "image" | "video";
	url: string;
	opacity: number;
	fit: "cover" | "contain" | "fill";
	position: string;
};

export type SpaceConfig = {
	ui?: {
		newChat?: {
			background?: NewChatBackgroundConfig;
		};
	};
};

type SpaceConfigListener = (config: SpaceConfig | null) => void;

const MAX_RETRY_ATTEMPTS = 5;
const RETRYABLE_ERROR_DELAY_MS = 1200;
const listeners = new Set<SpaceConfigListener>();

let activeSpaceId: string | null = null;
let activeVersion = 0;
let activeConfig: SpaceConfig | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function clearRetryTimer() {
	if (!retryTimer) return;
	clearTimeout(retryTimer);
	retryTimer = null;
}

function publish(config: SpaceConfig | null) {
	activeConfig = config;
	for (const listener of listeners) listener(config);
}

function parseHttpsUrl(value: unknown) {
	if (typeof value !== "string") return null;
	try {
		const url = new URL(value);
		return url.protocol === "https:" ? url.href : null;
	} catch {
		return null;
	}
}

function parseOptionalNumber(
	value: unknown,
	fallback: number,
	min: number,
	max: number,
) {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, value));
}

function parseBackground(value: unknown): NewChatBackgroundConfig | undefined {
	if (!value || typeof value !== "object") return undefined;
	const record = value as Record<string, unknown>;
	if (record.enabled === false) return undefined;
	const url = parseHttpsUrl(record.url);
	if (!url) return undefined;
	const type =
		record.type === "image" || record.type === "video" || record.type === "html"
			? record.type
			: "html";
	const fit =
		record.fit === "contain" || record.fit === "fill" || record.fit === "cover"
			? record.fit
			: "cover";
	return {
		type,
		url,
		opacity: parseOptionalNumber(record.opacity, 1, 0, 1),
		fit,
		position: typeof record.position === "string" ? record.position : "center",
	};
}

function parseSpaceConfig(raw: string): SpaceConfig | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object") return null;
	const record = parsed as Record<string, unknown>;
	if (record.version !== undefined && record.version !== 1) return null;
	const ui =
		record.ui && typeof record.ui === "object"
			? (record.ui as Record<string, unknown>)
			: undefined;
	const newChat =
		ui?.newChat && typeof ui.newChat === "object"
			? (ui.newChat as Record<string, unknown>)
			: undefined;
	const background = parseBackground(newChat?.background);
	return background ? { ui: { newChat: { background } } } : {};
}

function scheduleRetry(
	spaceId: string,
	version: number,
	attempt: number,
	delayMs: number,
) {
	if (attempt >= MAX_RETRY_ATTEMPTS) return;
	clearRetryTimer();
	retryTimer = setTimeout(
		() => {
			retryTimer = null;
			if (activeVersion !== version || activeSpaceId !== spaceId) return;
			void loadSpaceConfig(spaceId, { version, attempt: attempt + 1 });
		},
		Math.max(250, delayMs),
	);
}

async function loadSpaceConfig(
	spaceId: string,
	options: { version: number; attempt?: number },
) {
	const attempt = options.attempt ?? 0;
	try {
		const file = await sdk.space(spaceId).files.read(SPACE_CONFIG_PATH);
		if (activeVersion !== options.version || activeSpaceId !== spaceId) return;
		if (!("content" in file)) {
			scheduleRetry(spaceId, options.version, attempt, file.retryAfterMs);
			return;
		}
		const content =
			file.encoding === "base64" ? atob(file.content) : file.content;
		publish(parseSpaceConfig(content));
	} catch (error) {
		if (activeVersion !== options.version || activeSpaceId !== spaceId) return;
		if (error instanceof HttpError && error.status === 404) {
			publish(null);
			return;
		}
		const isRetryableHttpError =
			error instanceof HttpError &&
			(error.status === 408 || error.status === 429 || error.status >= 500);
		if (!(error instanceof HttpError) || isRetryableHttpError) {
			scheduleRetry(
				spaceId,
				options.version,
				attempt,
				RETRYABLE_ERROR_DELAY_MS * 2 ** attempt,
			);
		}
	}
}

export function activateSpaceConfig(spaceId: string) {
	clearRetryTimer();
	activeSpaceId = spaceId;
	activeVersion += 1;
	publish(null);
	void loadSpaceConfig(spaceId, { version: activeVersion });
}

export function refreshSpaceConfig(spaceId: string) {
	if (activeSpaceId !== spaceId) return;
	clearRetryTimer();
	activeVersion += 1;
	void loadSpaceConfig(spaceId, { version: activeVersion });
}

export function deactivateSpaceConfig(spaceId?: string) {
	if (spaceId && activeSpaceId !== spaceId) return;
	clearRetryTimer();
	activeSpaceId = null;
	activeVersion += 1;
	publish(null);
}

export function subscribeSpaceConfig(listener: SpaceConfigListener) {
	listeners.add(listener);
	listener(activeConfig);
	return () => listeners.delete(listener);
}

export function isSpaceConfigPath(path: string | null | undefined) {
	return path?.replace(/\\/g, "/").replace(/^\.\/+/, "") === SPACE_CONFIG_PATH;
}
