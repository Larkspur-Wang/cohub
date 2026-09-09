import type { AppRuntimeConfigureRequest } from "@cohub/protocol/app-runtime";
import type {
	AppDetailResponse,
	AppRuntimeInvocationContext,
} from "@neta-art/cohub";
import { appDisplayTitle } from "$lib/app-page-meta";
import { loadAppPreview } from "$lib/features/app/app-open";
import type {
	OverlayGeometry,
	OverlayInputRegion,
} from "./desktop-layer-geometry";

/** Upper bound on simultaneously mounted overlay iframes. */
export const OVERLAY_MAX = 8;

export type DesktopOverlay = {
	/** One overlay per App, so the App id doubles as the stable key. */
	readonly id: string;
	readonly appId: string;
	/** Bumped on retry so the iframe remounts. */
	mountKey: number;
	label: string;
	detail: AppDetailResponse | null;
	error: string | null;
	invocation: AppRuntimeInvocationContext;
	geometry: OverlayGeometry;
	inputRegion: OverlayInputRegion;
};

type DesktopLayerManagerOptions = {
	loadApp?: (appId: string) => Promise<AppDetailResponse>;
	loadPublicApp?: (appId: string) => Promise<AppDetailResponse>;
};

/**
 * Owns the App surfaces that float above the workspace. Unlike the tab-based
 * preview controllers there is no "active" overlay: every overlay is visible
 * at once and positions itself through `configure.request`.
 */
export function createDesktopLayerManager(
	options: DesktopLayerManagerOptions = {},
) {
	let overlays = $state<DesktopOverlay[]>([]);
	let nextMountKey = 0;

	const loadApp =
		options.loadApp ??
		(async (appId: string) => (await import("$lib/sdk")).sdk.apps.get(appId));
	const loadPublicApp =
		options.loadPublicApp ??
		(async (appId: string) =>
			(await import("$lib/sdk")).sdk.apps.getPublicById(appId));

	function find(appId: string) {
		return overlays.find((overlay) => overlay.appId === appId);
	}

	function patch(appId: string, next: Partial<DesktopOverlay>) {
		overlays = overlays.map((overlay) =>
			overlay.appId === appId ? { ...overlay, ...next } : overlay,
		);
	}

	async function loadDetail(appId: string) {
		try {
			const detail = await loadAppPreview(
				{ get: loadApp, getPublicById: loadPublicApp },
				appId,
			);
			if (!find(appId)) return;
			patch(appId, {
				detail,
				error: null,
				label: appDisplayTitle(detail.app.meta, detail.app.slug),
			});
		} catch (cause) {
			if (!find(appId)) return;
			patch(appId, {
				error:
					cause instanceof Error ? cause.message : "Failed to load this App.",
			});
		}
	}

	/** Opens an overlay, or refreshes the invocation of one already showing. */
	function openOverlay(input: {
		appId: string;
		label?: string;
		invocation: AppRuntimeInvocationContext;
	}): "opened" | "activated" | "limit" {
		if (find(input.appId)) {
			patch(input.appId, { invocation: input.invocation });
			return "activated";
		}
		if (overlays.length >= OVERLAY_MAX) return "limit";
		overlays = [
			...overlays,
			{
				id: `overlay:${input.appId}`,
				appId: input.appId,
				mountKey: ++nextMountKey,
				label: input.label?.trim() || "Overlay",
				detail: null,
				error: null,
				invocation: input.invocation,
				geometry: {},
				inputRegion: "none",
			},
		];
		void loadDetail(input.appId);
		return "opened";
	}

	function closeOverlay(appId: string) {
		overlays = overlays.filter((overlay) => overlay.appId !== appId);
	}

	function dismissAll() {
		overlays = [];
	}

	/** Applies a `configure.request`; absent fields keep their current value. */
	function configure(appId: string, request: AppRuntimeConfigureRequest) {
		const overlay = find(appId);
		if (!overlay) return;
		patch(appId, {
			...(request.geometry
				? { geometry: { ...overlay.geometry, ...request.geometry } }
				: {}),
			...(request.inputRegion !== undefined
				? { inputRegion: request.inputRegion }
				: {}),
		});
	}

	function retry(appId: string) {
		if (!find(appId)) return;
		patch(appId, { mountKey: ++nextMountKey, error: null, detail: null });
		void loadDetail(appId);
	}

	return {
		get overlays() {
			return overlays;
		},
		get count() {
			return overlays.length;
		},
		find,
		openOverlay,
		closeOverlay,
		dismissAll,
		configure,
		retry,
	};
}

export type DesktopLayerManager = ReturnType<typeof createDesktopLayerManager>;
