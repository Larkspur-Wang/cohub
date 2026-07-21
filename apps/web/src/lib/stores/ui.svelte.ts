// UI state shared across layout and pages
// Using a class to wrap $state so it can be mutated from imports

const LEGACY_STORAGE_KEYS = {
	leftSidebarWidth: "cohub:layout:left-sidebar-width",
	rightSidebarWidth: "cohub:layout:right-sidebar-width",
	immersiveChatWidth: "cohub:layout:immersive-chat-width",
	rightSidebarCollapsed: "cohub:layout:right-sidebar-collapsed",
	leftSidebarCollapsed: "cohub:layout:left-sidebar-collapsed",
	filesColumnHidden: "cohub:layout:files-column-hidden",
	workspacePresentation: "cohub:layout:workspace-presentation",
	workspaceLayoutSnapshot: "cohub:layout:workspace-layout-snapshot",
} as const;

const STORAGE_PREFIX = "cohub:layout:v2";
const GLOBAL_LAYOUT_SCOPE = "global";

type LayoutPrefKey = keyof typeof LEGACY_STORAGE_KEYS;

/** Preview panel presentation: default split, focus expand, or float immersive. */
export type WorkspacePresentation = "default" | "focus" | "immersive";

/** Pre-focus/immersive layout so exit (and post-refresh exit) can restore it. */
export type WorkspaceLayoutSnapshot = {
	leftSidebarCollapsed: boolean;
	rightSidebarCollapsed: boolean;
	filesColumnHidden: boolean;
	previewWidth: number;
	treeVisible: boolean;
};

function layoutStorageKey(scope: string, key: LayoutPrefKey) {
	return `${STORAGE_PREFIX}:${scope}:${key}`;
}

function layoutScopeKey(spaceId?: string | null) {
	return spaceId ? `space:${encodeURIComponent(spaceId)}` : GLOBAL_LAYOUT_SCOPE;
}

const LEFT_SIDEBAR_MIN = 220;
const LEFT_SIDEBAR_MAX = 420;
const LEFT_SIDEBAR_DEFAULT = 240;
/** Collapsed desktop rail width (icon column). */
const LEFT_SIDEBAR_RAIL = 52;
const RIGHT_SIDEBAR_MIN = 260;
const RIGHT_SIDEBAR_MAX = 520;
const RIGHT_SIDEBAR_DEFAULT = 320;
const IMMERSIVE_CHAT_MIN = 320;
const IMMERSIVE_CHAT_MAX = 760;
const IMMERSIVE_CHAT_DEFAULT = 640;

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function readStorage(key: string) {
	if (typeof window === "undefined") return null;

	try {
		return window.localStorage.getItem(key);
	} catch {
		return null;
	}
}

function writeStorage(key: string, value: string) {
	if (typeof window === "undefined") return;

	try {
		window.localStorage.setItem(key, value);
	} catch {
		// Ignore storage failures so layout interactions remain functional.
	}
}

class UIState {
	mobileDrawerOpen = $state(false);
	mobileRightDrawerOpen = $state(false);
	/** Drag offset for right drawer gesture tracking (shared from layout) */
	rightDragOffsetPx = $state(0);
	/** Whether a right drawer drag is in progress (shared from layout) */
	rightIsDragging = $state(false);
	settingsOverlayOpen = $state(false);
	leftSidebarWidth = $state(LEFT_SIDEBAR_DEFAULT);
	rightSidebarWidth = $state(RIGHT_SIDEBAR_DEFAULT);
	immersiveChatWidth = $state(IMMERSIVE_CHAT_DEFAULT);
	leftSidebarCollapsed = $state(false);
	rightSidebarCollapsed = $state(false);
	/** Hide the whole Files column (preview stage + tree). Space-scoped. */
	filesColumnHidden = $state(false);
	/** Preview presentation mode (focus / immersive). Space-scoped. */
	workspacePresentation = $state<WorkspacePresentation>("default");
	/** Layout captured before entering focus/immersive. Space-scoped. */
	workspaceLayoutSnapshot = $state<WorkspaceLayoutSnapshot | null>(null);
	private layoutScope: string | null = null;

	private readLayoutPref(key: LayoutPrefKey) {
		return (
			readStorage(
				layoutStorageKey(this.layoutScope ?? GLOBAL_LAYOUT_SCOPE, key),
			) ?? readStorage(LEGACY_STORAGE_KEYS[key])
		);
	}

	private writeLayoutPref(key: LayoutPrefKey, value: string) {
		writeStorage(
			layoutStorageKey(this.layoutScope ?? GLOBAL_LAYOUT_SCOPE, key),
			value,
		);
	}

	private parseWidth(
		raw: string | null,
		fallback: number,
		min: number,
		max: number,
	) {
		if (!raw) return fallback;
		const parsed = Number(raw);
		return Number.isFinite(parsed) ? clamp(parsed, min, max) : fallback;
	}

	private parseCollapsed(raw: string | null, fallback: boolean) {
		return raw === "true" || raw === "false" ? raw === "true" : fallback;
	}

	private parsePresentation(raw: string | null): WorkspacePresentation {
		if (raw === "focus" || raw === "immersive" || raw === "default") return raw;
		return "default";
	}

	private parseLayoutSnapshot(
		raw: string | null,
	): WorkspaceLayoutSnapshot | null {
		if (!raw) return null;
		try {
			const parsed: unknown = JSON.parse(raw);
			if (!parsed || typeof parsed !== "object") return null;
			const snap = parsed as Record<string, unknown>;
			const previewWidth = Number(snap.previewWidth);
			if (!Number.isFinite(previewWidth) || previewWidth <= 0) return null;
			return {
				leftSidebarCollapsed: snap.leftSidebarCollapsed === true,
				rightSidebarCollapsed: snap.rightSidebarCollapsed === true,
				filesColumnHidden: snap.filesColumnHidden === true,
				previewWidth,
				treeVisible: snap.treeVisible === true,
			};
		} catch {
			return null;
		}
	}

	private persistLayoutPrefs() {
		this.writeLayoutPref("leftSidebarWidth", String(this.leftSidebarWidth));
		this.writeLayoutPref("rightSidebarWidth", String(this.rightSidebarWidth));
		this.writeLayoutPref("immersiveChatWidth", String(this.immersiveChatWidth));
		this.writeLayoutPref(
			"leftSidebarCollapsed",
			String(this.leftSidebarCollapsed),
		);
		this.writeLayoutPref(
			"rightSidebarCollapsed",
			String(this.rightSidebarCollapsed),
		);
		this.writeLayoutPref("filesColumnHidden", String(this.filesColumnHidden));
		this.writeLayoutPref("workspacePresentation", this.workspacePresentation);
		this.writeLayoutPref(
			"workspaceLayoutSnapshot",
			this.workspaceLayoutSnapshot
				? JSON.stringify(this.workspaceLayoutSnapshot)
				: "",
		);
	}

	loadLayoutPrefs(spaceId?: string | null) {
		if (typeof window === "undefined") return;

		const nextScope = layoutScopeKey(spaceId);
		if (this.layoutScope === nextScope) return;
		this.layoutScope = nextScope;

		const rawLeftWidth = this.readLayoutPref("leftSidebarWidth");
		const rawRightWidth = this.readLayoutPref("rightSidebarWidth");
		const rawImmersiveChatWidth = this.readLayoutPref("immersiveChatWidth");
		const rawLeftCollapsed = this.readLayoutPref("leftSidebarCollapsed");
		const rawRightCollapsed = this.readLayoutPref("rightSidebarCollapsed");
		const rawFilesColumnHidden = this.readLayoutPref("filesColumnHidden");
		const rawPresentation = this.readLayoutPref("workspacePresentation");
		const rawLayoutSnapshot = this.readLayoutPref("workspaceLayoutSnapshot");

		this.leftSidebarWidth = this.parseWidth(
			rawLeftWidth,
			LEFT_SIDEBAR_DEFAULT,
			LEFT_SIDEBAR_MIN,
			LEFT_SIDEBAR_MAX,
		);
		this.rightSidebarWidth = this.parseWidth(
			rawRightWidth,
			RIGHT_SIDEBAR_DEFAULT,
			RIGHT_SIDEBAR_MIN,
			RIGHT_SIDEBAR_MAX,
		);
		this.immersiveChatWidth = this.parseWidth(
			rawImmersiveChatWidth,
			IMMERSIVE_CHAT_DEFAULT,
			IMMERSIVE_CHAT_MIN,
			IMMERSIVE_CHAT_MAX,
		);
		this.leftSidebarCollapsed = this.parseCollapsed(rawLeftCollapsed, false);
		this.rightSidebarCollapsed = this.parseCollapsed(rawRightCollapsed, false);
		this.filesColumnHidden = this.parseCollapsed(rawFilesColumnHidden, false);

		const snapshot = this.parseLayoutSnapshot(rawLayoutSnapshot);
		let presentation = this.parsePresentation(rawPresentation);
		// Non-default presentation needs a restore snapshot; otherwise fall back.
		if (presentation !== "default" && !snapshot) presentation = "default";
		// Default mode never carries a restore snapshot.
		this.workspaceLayoutSnapshot = presentation === "default" ? null : snapshot;
		this.workspacePresentation = presentation;
		this.persistLayoutPrefs();
	}

	setLeftSidebarWidth(width: number) {
		const next = clamp(width, LEFT_SIDEBAR_MIN, LEFT_SIDEBAR_MAX);
		this.leftSidebarWidth = next;
		this.writeLayoutPref("leftSidebarWidth", String(next));
	}

	setRightSidebarWidth(width: number) {
		const next = clamp(width, RIGHT_SIDEBAR_MIN, RIGHT_SIDEBAR_MAX);
		this.rightSidebarWidth = next;
		this.writeLayoutPref("rightSidebarWidth", String(next));
	}

	setImmersiveChatWidth(width: number) {
		const next = clamp(width, IMMERSIVE_CHAT_MIN, IMMERSIVE_CHAT_MAX);
		this.immersiveChatWidth = next;
		this.writeLayoutPref("immersiveChatWidth", String(next));
	}

	setLeftSidebarCollapsed(collapsed: boolean) {
		this.leftSidebarCollapsed = collapsed;
		this.writeLayoutPref("leftSidebarCollapsed", String(collapsed));
	}

	setRightSidebarCollapsed(collapsed: boolean) {
		this.rightSidebarCollapsed = collapsed;
		this.writeLayoutPref("rightSidebarCollapsed", String(collapsed));
	}

	setFilesColumnHidden(hidden: boolean) {
		this.filesColumnHidden = hidden;
		this.writeLayoutPref("filesColumnHidden", String(hidden));
	}

	setWorkspacePresentation(presentation: WorkspacePresentation) {
		this.workspacePresentation = presentation;
		this.writeLayoutPref("workspacePresentation", presentation);
	}

	setWorkspaceLayoutSnapshot(snapshot: WorkspaceLayoutSnapshot | null) {
		this.workspaceLayoutSnapshot = snapshot;
		this.writeLayoutPref(
			"workspaceLayoutSnapshot",
			snapshot ? JSON.stringify(snapshot) : "",
		);
	}

	toggleLeftSidebarCollapsed() {
		this.setLeftSidebarCollapsed(!this.leftSidebarCollapsed);
	}

	toggleRightSidebarCollapsed() {
		this.setRightSidebarCollapsed(!this.rightSidebarCollapsed);
	}
}

export const uiState = new UIState();
export {
	IMMERSIVE_CHAT_DEFAULT,
	IMMERSIVE_CHAT_MAX,
	IMMERSIVE_CHAT_MIN,
	LEFT_SIDEBAR_DEFAULT,
	LEFT_SIDEBAR_MAX,
	LEFT_SIDEBAR_MIN,
	LEFT_SIDEBAR_RAIL,
	RIGHT_SIDEBAR_DEFAULT,
	RIGHT_SIDEBAR_MAX,
	RIGHT_SIDEBAR_MIN,
};
