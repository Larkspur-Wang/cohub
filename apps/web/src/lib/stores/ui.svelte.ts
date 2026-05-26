// UI state shared across layout and pages
// Using a class to wrap $state so it can be mutated from imports

const STORAGE_KEYS = {
	leftSidebarWidth: "cohub:layout:left-sidebar-width",
	rightSidebarWidth: "cohub:layout:right-sidebar-width",
	rightSidebarCollapsed: "cohub:layout:right-sidebar-collapsed",
	leftSidebarCollapsed: "cohub:layout:left-sidebar-collapsed",
} as const;

const LEFT_SIDEBAR_MIN = 220;
const LEFT_SIDEBAR_MAX = 420;
const LEFT_SIDEBAR_DEFAULT = 240;
const RIGHT_SIDEBAR_MIN = 260;
const RIGHT_SIDEBAR_MAX = 520;
const RIGHT_SIDEBAR_DEFAULT = 320;

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
	leftSidebarCollapsed = $state(false);
	rightSidebarCollapsed = $state(false);
	private layoutPrefsLoaded = false;

	loadLayoutPrefs() {
		if (this.layoutPrefsLoaded || typeof window === "undefined") return;
		this.layoutPrefsLoaded = true;

		const rawLeftWidth = readStorage(STORAGE_KEYS.leftSidebarWidth);
		const rawRightWidth = readStorage(STORAGE_KEYS.rightSidebarWidth);
		const rawLeftCollapsed = readStorage(STORAGE_KEYS.leftSidebarCollapsed);
		const rawRightCollapsed = readStorage(STORAGE_KEYS.rightSidebarCollapsed);

		if (rawLeftWidth) {
			const parsed = Number(rawLeftWidth);
			if (Number.isFinite(parsed)) {
				this.leftSidebarWidth = clamp(
					parsed,
					LEFT_SIDEBAR_MIN,
					LEFT_SIDEBAR_MAX,
				);
			}
		}

		if (rawRightWidth) {
			const parsed = Number(rawRightWidth);
			if (Number.isFinite(parsed)) {
				this.rightSidebarWidth = clamp(
					parsed,
					RIGHT_SIDEBAR_MIN,
					RIGHT_SIDEBAR_MAX,
				);
			}
		}

		if (rawLeftCollapsed === "true" || rawLeftCollapsed === "false") {
			this.leftSidebarCollapsed = rawLeftCollapsed === "true";
		}

		if (rawRightCollapsed === "true" || rawRightCollapsed === "false") {
			this.rightSidebarCollapsed = rawRightCollapsed === "true";
		}
	}

	setLeftSidebarWidth(width: number) {
		const next = clamp(width, LEFT_SIDEBAR_MIN, LEFT_SIDEBAR_MAX);
		this.leftSidebarWidth = next;
		writeStorage(STORAGE_KEYS.leftSidebarWidth, String(next));
	}

	setRightSidebarWidth(width: number) {
		const next = clamp(width, RIGHT_SIDEBAR_MIN, RIGHT_SIDEBAR_MAX);
		this.rightSidebarWidth = next;
		writeStorage(STORAGE_KEYS.rightSidebarWidth, String(next));
	}

	setLeftSidebarCollapsed(collapsed: boolean) {
		this.leftSidebarCollapsed = collapsed;
		writeStorage(STORAGE_KEYS.leftSidebarCollapsed, String(collapsed));
	}

	setRightSidebarCollapsed(collapsed: boolean) {
		this.rightSidebarCollapsed = collapsed;
		writeStorage(STORAGE_KEYS.rightSidebarCollapsed, String(collapsed));
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
	LEFT_SIDEBAR_DEFAULT,
	LEFT_SIDEBAR_MAX,
	LEFT_SIDEBAR_MIN,
	RIGHT_SIDEBAR_DEFAULT,
	RIGHT_SIDEBAR_MAX,
	RIGHT_SIDEBAR_MIN,
};
