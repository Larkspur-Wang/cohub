import { SPACE_CUSTOM_THEME_CSS_PATH } from "@cohub/protocol";
import { HttpError, type SpaceFsFileResponse } from "@neta-art/cohub";
import { sdk } from "$lib/sdk";

const SPACE_STYLE_NODE_ATTR = "data-cohub-space-style";
const SPACE_STYLE_ACTIVE_ATTR = "data-cohub-space-style-active";
const SPACE_STYLE_SPACE_ATTR = "data-space-id";
const MAX_RETRY_ATTEMPTS = 5;
const RETRYABLE_ERROR_DELAY_MS = 1200;

let activeSpaceId: string | null = null;
let activeVersion = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function clearRetryTimer() {
	if (!retryTimer) return;
	clearTimeout(retryTimer);
	retryTimer = null;
}

function removeSpaceStyleNodes() {
	if (typeof document === "undefined") return;
	for (const node of document.querySelectorAll(`[${SPACE_STYLE_NODE_ATTR}]`)) {
		node.remove();
	}
	document.documentElement.removeAttribute(SPACE_STYLE_ACTIVE_ATTR);
	document.documentElement.removeAttribute(SPACE_STYLE_SPACE_ATTR);
}

function markActiveSpaceStyle(spaceId: string) {
	document.documentElement.setAttribute(SPACE_STYLE_ACTIVE_ATTR, "true");
	document.documentElement.setAttribute(SPACE_STYLE_SPACE_ATTR, spaceId);
}

function installLinkedStyle(spaceId: string, href: string, version: number) {
	removeSpaceStyleNodes();
	if (activeVersion !== version || activeSpaceId !== spaceId) return;
	const link = document.createElement("link");
	link.rel = "stylesheet";
	link.href = href;
	link.setAttribute(SPACE_STYLE_NODE_ATTR, "true");
	link.setAttribute(SPACE_STYLE_SPACE_ATTR, spaceId);
	document.head.append(link);
	markActiveSpaceStyle(spaceId);
}

function installInlineStyle(
	spaceId: string,
	file: SpaceFsFileResponse,
	version: number,
) {
	removeSpaceStyleNodes();
	if (activeVersion !== version || activeSpaceId !== spaceId) return;
	const style = document.createElement("style");
	style.textContent =
		file.encoding === "base64" ? atob(file.content) : file.content;
	style.setAttribute(SPACE_STYLE_NODE_ATTR, "true");
	style.setAttribute(SPACE_STYLE_SPACE_ATTR, spaceId);
	document.head.append(style);
	markActiveSpaceStyle(spaceId);
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
			void loadSpaceStyle(spaceId, { version, attempt: attempt + 1 });
		},
		Math.max(250, delayMs),
	);
}

async function loadSpaceStyle(
	spaceId: string,
	options: { version: number; attempt?: number },
) {
	const attempt = options.attempt ?? 0;
	try {
		const file = await sdk
			.space(spaceId)
			.files.read(SPACE_CUSTOM_THEME_CSS_PATH);
		if (activeVersion !== options.version || activeSpaceId !== spaceId) return;
		if (!("content" in file)) {
			scheduleRetry(spaceId, options.version, attempt, file.retryAfterMs);
			return;
		}
		if (file.delivery === "url" && file.url) {
			installLinkedStyle(spaceId, file.url, options.version);
			return;
		}
		installInlineStyle(spaceId, file, options.version);
	} catch (error) {
		if (activeVersion !== options.version || activeSpaceId !== spaceId) return;
		if (error instanceof HttpError && error.status === 404) {
			removeSpaceStyleNodes();
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
		// Custom styles should never block the workspace. Keep the default theme.
	}
}

export function activateSpaceStyle(spaceId: string) {
	if (typeof document === "undefined") return;
	clearRetryTimer();
	activeSpaceId = spaceId;
	activeVersion += 1;
	removeSpaceStyleNodes();
	void loadSpaceStyle(spaceId, { version: activeVersion });
}

export function refreshSpaceStyle(spaceId: string) {
	if (typeof document === "undefined") return;
	if (activeSpaceId !== spaceId) return;
	clearRetryTimer();
	activeVersion += 1;
	void loadSpaceStyle(spaceId, { version: activeVersion });
}

export function deactivateSpaceStyle(spaceId?: string) {
	if (spaceId && activeSpaceId !== spaceId) return;
	clearRetryTimer();
	activeSpaceId = null;
	activeVersion += 1;
	removeSpaceStyleNodes();
}

export function isSpaceStylePath(path: string | null | undefined) {
	return (
		path?.replace(/\\/g, "/").replace(/^\.\/+/, "") ===
		SPACE_CUSTOM_THEME_CSS_PATH
	);
}
