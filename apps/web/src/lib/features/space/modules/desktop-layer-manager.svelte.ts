import type {
	AppRuntimeConfigureRequest,
	AppRuntimeRect,
} from "@cohub/protocol/app-runtime";
import type { AppComposerChip } from "@cohub/protocol/app-surface";
import type {
	AppDetailResponse,
	AppRuntimeInvocationContext,
} from "@neta-art/cohub";
import { loadAppPreview } from "$lib/features/app/app-open";

/** Maximum number of live overlay surfaces at once. */
export const OVERLAY_MAX = 8;

export type OverlayGeometry = {
	/** Corner to anchor (x, y) to.  Defaults to `"top-left"`. */
	anchor?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
	x?: number;
	y?: number;
	width?: number;
	height?: number;
};

export type OverlayInputRegion = "all" | "none" | AppRuntimeRect[];

export type DesktopOverlay = {
	/** Stable id — one App can have at most one overlay at a time. */
	readonly id: string;
	readonly appId: string;
	/** Key incremented on retry to force iframe remount. */
	mountKey: number;
	label: string;
	/** Loaded App detail — `null` while loading. */
	detail: AppDetailResponse | null;
	loading: boolean;
	error: string | null;
	readonly invocation: AppRuntimeInvocationContext;
	geometry: OverlayGeometry;
	inputRegion: OverlayInputRegion;
	composerChip: AppComposerChip | null;
};

type DesktopLayerManagerOptions = {
	loadApp?: (appId: string) => Promise<AppDetailResponse>;
	loadPublicApp?: (appId: string) => Promise<AppDetailResponse>;
};

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

	async function fetchDetail(appId: string): Promise<AppDetailResponse> {
		return loadAppPreview(
			{ get: loadApp, getPublicById: loadPublicApp },
			appId,
		);
	}

	function find(appId: string): DesktopOverlay | undefined {
		return overlays.find((o) => o.appId === appId);
	}

	function patch(appId: string, next: Partial<DesktopOverlay>) {
		overlays = overlays.map((o) => (o.appId === appId ? { ...o, ...next } : o));
	}

	async function loadDetail(appId: string) {
		patch(appId, { loading: true, error: null });
		try {
			const detail = await fetchDetail(appId);
			// Guard: overlay may have been closed while loading.
			if (!find(appId)) return;
			patch(appId, {
				detail,
				loading: false,
				label: detail.app.meta?.title?.trim() || detail.app.slug,
			});
		} catch (cause) {
			if (!find(appId)) return;
			patch(appId, {
				loading: false,
				error:
					cause instanceof Error ? cause.message : "Failed to load this App.",
			});
		}
	}

	/**
	 * Open an overlay for the given App.  If one is already open for that App,
	 * it is activated (invocation updated) rather than duplicated.
	 * Returns `"limit"` when no more overlays can be opened.
	 */
	function openOverlay(input: {
		appId: string;
		label?: string;
		invocation: AppRuntimeInvocationContext;
	}): "opened" | "activated" | "limit" {
		const existing = find(input.appId);
		if (existing) {
			// Re-activate: update invocation context, keep detail.
			patch(input.appId, { invocation: input.invocation });
			return "activated";
		}
		if (overlays.length >= OVERLAY_MAX) return "limit";
		const overlay: DesktopOverlay = {
			id: `overlay:${input.appId}`,
			appId: input.appId,
			mountKey: ++nextMountKey,
			label: input.label?.trim() || "Overlay",
			detail: null,
			loading: true,
			error: null,
			invocation: input.invocation,
			geometry: {},
			inputRegion: "none",
			composerChip: null,
		};
		overlays = [...overlays, overlay];
		void loadDetail(input.appId);
		return "opened";
	}

	function closeOverlay(appId: string) {
		overlays = overlays.filter((o) => o.appId !== appId);
	}

	function dismissAll() {
		overlays = [];
	}

	/** Update geometry or input region from an App's `configure.request`. */
	function configure(
		appId: string,
		update: {
			geometry?: AppRuntimeConfigureRequest["geometry"];
			inputRegion?: AppRuntimeConfigureRequest["inputRegion"];
		},
	) {
		const overlay = find(appId);
		if (!overlay) return;
		const next: Partial<DesktopOverlay> = {};
		if (update.geometry !== undefined) {
			// Merge into current geometry so partial updates don't clear fields.
			next.geometry = {
				...overlay.geometry,
				...update.geometry,
			} as OverlayGeometry;
		}
		if (update.inputRegion !== undefined) {
			next.inputRegion = update.inputRegion as OverlayInputRegion;
		}
		patch(appId, next);
	}

	function retry(appId: string) {
		patch(appId, { mountKey: ++nextMountKey, error: null, detail: null });
		void loadDetail(appId);
	}

	function setComposerChip(appId: string, chip: AppComposerChip | null) {
		patch(appId, { composerChip: chip });
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
		setComposerChip,
	};
}

export type DesktopLayerManager = ReturnType<typeof createDesktopLayerManager>;

/**
 * Compute the CSS `style` string for a single overlay element.
 * Values are clamped to stay within the host viewport.
 */
export function resolveOverlayStyle(
	geometry: OverlayGeometry,
	vpWidth: number,
	vpHeight: number,
): string {
	const anchor = geometry.anchor ?? "top-left";
	const w =
		geometry.width != null
			? Math.max(1, Math.min(geometry.width, vpWidth))
			: undefined;
	const h =
		geometry.height != null
			? Math.max(1, Math.min(geometry.height, vpHeight))
			: undefined;
	const x = geometry.x ?? 0;
	const y = geometry.y ?? 0;

	const parts: string[] = ["position: absolute", "contain: strict"];

	if (w != null) parts.push(`width: ${w}px`);
	if (h != null) parts.push(`height: ${h}px`);

	switch (anchor) {
		case "top-left":
			parts.push(
				`left: ${clamp(x, 0, vpWidth)}px`,
				`top: ${clamp(y, 0, vpHeight)}px`,
			);
			break;
		case "top-right":
			parts.push(
				`right: ${clamp(x, 0, vpWidth)}px`,
				`top: ${clamp(y, 0, vpHeight)}px`,
			);
			break;
		case "bottom-left":
			parts.push(
				`left: ${clamp(x, 0, vpWidth)}px`,
				`bottom: ${clamp(y, 0, vpHeight)}px`,
			);
			break;
		case "bottom-right":
			parts.push(
				`right: ${clamp(x, 0, vpWidth)}px`,
				`bottom: ${clamp(y, 0, vpHeight)}px`,
			);
			break;
		case "center": {
			const cx = clamp(vpWidth / 2 + x, 0, vpWidth);
			const cy = clamp(vpHeight / 2 + y, 0, vpHeight);
			parts.push(
				`left: ${cx}px`,
				`top: ${cy}px`,
				`transform: translate(-50%, -50%)`,
			);
			break;
		}
	}

	return parts.join("; ");
}

function clamp(v: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(v, hi));
}
