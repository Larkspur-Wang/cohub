import {
	isValidPortKey,
	type WorkspacePreviewRef,
} from "./workspace-preview-route";

/** Preview panel presentation declared by a space default layout. */
export type WorkspaceLayoutPresentation = "split" | "focus" | "fullscreen";

/**
 * Default workspace layout for a space. Every field is optional; unset fields
 * fall back to Cohub built-in defaults. Applied only as a fallback when the
 * viewer has no local layout preference for the space yet.
 */
export type WorkspaceDefaultLayout = {
	leftSidebar?: "expanded" | "collapsed";
	filesColumn?: "visible" | "hidden";
	fileTree?: "expanded" | "collapsed";
	preview?: WorkspacePreviewRef;
	presentation?: WorkspaceLayoutPresentation;
};

function normalizePreviewPath(value: unknown) {
	if (typeof value !== "string") return null;
	const normalized = value
		.replace(/\\/g, "/")
		.replace(/^\.\/+/, "")
		.replace(/^\/+/, "")
		.trim();
	return normalized.length > 0 ? normalized : null;
}

function parsePreview(value: unknown): WorkspacePreviewRef | undefined {
	if (!value || typeof value !== "object") return undefined;
	const record = value as Record<string, unknown>;
	const kind = record.kind;
	if (kind === "file" || kind === "canvas") {
		const key = normalizePreviewPath(record.path ?? record.key);
		return key ? { kind, key } : undefined;
	}
	if (kind === "port") {
		const key =
			typeof record.port === "string" ? record.port : String(record.port ?? "");
		return isValidPortKey(key) ? { kind, key } : undefined;
	}
	return undefined;
}

/** Parse and validate a `ui.workspace.defaultLayout` record from space config. */
export function parseWorkspaceDefaultLayout(
	value: unknown,
): WorkspaceDefaultLayout | undefined {
	if (!value || typeof value !== "object") return undefined;
	const record = value as Record<string, unknown>;
	const layout: WorkspaceDefaultLayout = {};
	if (record.leftSidebar === "expanded" || record.leftSidebar === "collapsed")
		layout.leftSidebar = record.leftSidebar;
	if (record.filesColumn === "visible" || record.filesColumn === "hidden")
		layout.filesColumn = record.filesColumn;
	if (record.fileTree === "expanded" || record.fileTree === "collapsed")
		layout.fileTree = record.fileTree;
	if (
		record.presentation === "split" ||
		record.presentation === "focus" ||
		record.presentation === "fullscreen"
	)
		layout.presentation = record.presentation;
	const preview = parsePreview(record.preview);
	if (preview) layout.preview = preview;
	return Object.keys(layout).length > 0 ? layout : undefined;
}

/** Resolved presentation for the workspace layout controller / uiState. */
export type ResolvedPresentation = "default" | "focus" | "immersive";

/** Base (pre-presentation) geometry resolved from a default layout. */
export type ResolvedDefaultLayoutGeometry = {
	leftSidebarCollapsed: boolean;
	rightSidebarCollapsed: boolean;
	filesColumnHidden: boolean;
	presentation: ResolvedPresentation;
	/** Whether the configured preview should be opened for this fresh entry. */
	openPreview: boolean;
};

/**
 * Resolve a space default layout into concrete base geometry. Pure so the
 * precedence rules (explicit route preview wins, presentation needs a preview)
 * stay testable independent of uiState.
 *
 * @param hasRoutePreview whether the URL already carries an explicit `?preview=`.
 */
export function resolveDefaultLayoutGeometry(
	layout: WorkspaceDefaultLayout,
	hasRoutePreview: boolean,
): ResolvedDefaultLayoutGeometry {
	const hasPreview = Boolean(layout.preview) || hasRoutePreview;
	const presentation: ResolvedPresentation =
		hasPreview && layout.presentation === "focus"
			? "focus"
			: hasPreview && layout.presentation === "fullscreen"
				? "immersive"
				: "default";
	return {
		leftSidebarCollapsed: layout.leftSidebar === "collapsed",
		rightSidebarCollapsed: layout.fileTree === "collapsed",
		// Never hide the Files column while a preview (config or explicit URL)
		// needs to render — explicit preview must win over `filesColumn: hidden`.
		filesColumnHidden: layout.filesColumn === "hidden" && !hasPreview,
		presentation,
		openPreview: Boolean(layout.preview),
	};
}
