import type {
	SpaceFsFileResponse,
	SpaceFsPreparingFile,
} from "@neta-art/cohub";
import { normalizeWorkspaceFileLink } from "$lib/workspace-file-links";

export type WorkspaceAsset = {
	src: string;
	mimeType: string | null;
};

export type ResolveWorkspaceAsset = (
	path: string,
	options: { signal: AbortSignal },
) => Promise<WorkspaceAsset>;

/**
 * Raised when the viewer cannot read workspace files at all, e.g. a shared
 * session viewed with minimal access. Surfaces render a lightweight placeholder
 * instead of a broken asset, and no request is issued.
 */
export class WorkspaceAssetAccessError extends Error {
	override name = "WorkspaceAssetAccessError";

	constructor(message = "No access to workspace files") {
		super(message);
	}
}

/** Resolver for surfaces where the viewer has no workspace file access. */
export const denyWorkspaceAsset: ResolveWorkspaceAsset = () =>
	Promise.reject(new WorkspaceAssetAccessError());

type ReadWorkspaceAssetFile = (
	path: string,
	signal: AbortSignal,
) => Promise<SpaceFsFileResponse | SpaceFsPreparingFile>;

export function createWorkspaceAssetLoader(
	resolve: ResolveWorkspaceAsset,
	signal: AbortSignal,
	concurrency = 4,
) {
	const pending = new Map<string, Promise<WorkspaceAsset>>();
	const lanes = Array.from({ length: Math.max(1, concurrency) }, () =>
		Promise.resolve(),
	);
	let nextLane = 0;

	return (path: string) => {
		const cached = pending.get(path);
		if (cached) return cached;
		const lane = nextLane++ % lanes.length;
		const request = lanes[lane].then(() => resolve(path, { signal }));
		lanes[lane] = request.then(
			() => undefined,
			() => undefined,
		);
		pending.set(path, request);
		return request;
	};
}

const WORKSPACE_ASSET_TIMEOUT_MS = 15_000;
const WORKSPACE_ASSET_MIN_RETRY_MS = 250;
const WORKSPACE_ASSET_MAX_RETRY_MS = 2_000;

function abortError() {
	return new DOMException("Aborted", "AbortError");
}

function waitForRetry(delayMs: number, signal: AbortSignal) {
	return new Promise<void>((resolve, reject) => {
		if (signal.aborted) {
			reject(abortError());
			return;
		}
		const onAbort = () => {
			clearTimeout(timer);
			reject(abortError());
		};
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, delayMs);
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

export async function resolveWorkspaceFileAsset(
	read: ReadWorkspaceAssetFile,
	path: string,
	options: { signal: AbortSignal; timeoutMs?: number },
) {
	const { signal } = options;
	const timeoutMs = Math.max(
		0,
		options.timeoutMs ?? WORKSPACE_ASSET_TIMEOUT_MS,
	);
	const deadlineAt = Date.now() + timeoutMs;

	while (true) {
		if (signal.aborted) throw abortError();
		const file = await read(path, signal);
		if (signal.aborted) throw abortError();
		if ("content" in file) return fileResponseAsset(file);

		const remainingMs = deadlineAt - Date.now();
		if (remainingMs <= 0) throw new Error("Asset is still preparing");
		const retryAfterMs = Math.max(
			WORKSPACE_ASSET_MIN_RETRY_MS,
			Math.min(file.retryAfterMs, WORKSPACE_ASSET_MAX_RETRY_MS),
		);
		await waitForRetry(Math.min(retryAfterMs, remainingMs), signal);
	}
}

function resolveWorkspaceAssetPath(reference: string, basePath: string | null) {
	return normalizeWorkspaceFileLink(reference, { basePath });
}

const WORKSPACE_ASSET_SELECTORS = [
	["img[src]", "src"],
	["audio[src]", "src"],
	["video[src]", "src"],
	["source[src]", "src"],
	["video[poster]", "poster"],
] as const;

export function fileResponseAsset(file: SpaceFsFileResponse): WorkspaceAsset {
	const mimeType = file.mimeType ?? null;
	if (file.delivery === "url" && file.url) {
		return { src: file.url, mimeType };
	}
	if (file.kind === "text") {
		const type = mimeType ?? "text/plain";
		return {
			src: `data:${type};charset=utf-8,${encodeURIComponent(file.content)}`,
			mimeType,
		};
	}
	return {
		src: `data:${mimeType ?? "application/octet-stream"};base64,${file.content}`,
		mimeType,
	};
}

export function prepareWorkspaceAssetHtml(
	html: string,
	basePath: string | null,
) {
	if (typeof document === "undefined") return html;
	const template = document.createElement("template");
	template.innerHTML = html;

	for (const [selector, attribute] of WORKSPACE_ASSET_SELECTORS) {
		for (const element of template.content.querySelectorAll<HTMLElement>(
			selector,
		)) {
			const reference = element.getAttribute(attribute)?.trim();
			if (!reference) continue;
			const path = resolveWorkspaceAssetPath(reference, basePath);
			if (!path) continue;
			if (attribute === "src") element.dataset.workspaceAssetSrc = path;
			else element.dataset.workspaceAssetPoster = path;
			const parent = element.parentElement;
			const stateElement =
				element.tagName === "SOURCE" &&
				(parent?.tagName === "AUDIO" || parent?.tagName === "VIDEO")
					? parent
					: element;
			stateElement.dataset.workspaceAssetState = "loading";
			stateElement.setAttribute("aria-busy", "true");
			element.removeAttribute(attribute);
		}
	}

	return template.innerHTML;
}
