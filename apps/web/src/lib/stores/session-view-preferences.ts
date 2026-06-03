export type SessionViewMode = "chat" | "split";

const SESSION_MODE_KEY_PREFIX = "cohub:session-mode";
const SPLIT_TURN_LIST_WIDTH_KEY_PREFIX = "cohub:session-split-turn-list-width";

export const SPLIT_TURN_LIST_MIN_WIDTH = 260;
export const SPLIT_TURN_LIST_MAX_WIDTH = 460;
export const SPLIT_TURN_LIST_DEFAULT_WIDTH = 320;

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
		// Ignore storage failures so view interactions remain functional.
	}
}

function getSpaceSessionModePreferenceKey(spaceId: string) {
	return `${SESSION_MODE_KEY_PREFIX}:${spaceId}`;
}

function getSpaceSplitTurnListWidthKey(spaceId: string) {
	return `${SPLIT_TURN_LIST_WIDTH_KEY_PREFIX}:${spaceId}`;
}

export function isSessionViewMode(value: unknown): value is SessionViewMode {
	return value === "chat" || value === "split";
}

export function clampSplitTurnListWidth(width: number) {
	return Math.min(
		SPLIT_TURN_LIST_MAX_WIDTH,
		Math.max(SPLIT_TURN_LIST_MIN_WIDTH, width),
	);
}

export function loadSpaceSessionModePreference(spaceId: string) {
	const value = readStorage(getSpaceSessionModePreferenceKey(spaceId));
	return isSessionViewMode(value) ? value : null;
}

export function saveSpaceSessionModePreference(
	spaceId: string,
	mode: SessionViewMode,
) {
	writeStorage(getSpaceSessionModePreferenceKey(spaceId), mode);
}

export function loadSpaceSplitTurnListWidth(spaceId: string) {
	const value = Number(readStorage(getSpaceSplitTurnListWidthKey(spaceId)));
	return Number.isFinite(value)
		? clampSplitTurnListWidth(value)
		: SPLIT_TURN_LIST_DEFAULT_WIDTH;
}

export function saveSpaceSplitTurnListWidth(spaceId: string, width: number) {
	writeStorage(
		getSpaceSplitTurnListWidthKey(spaceId),
		String(clampSplitTurnListWidth(width)),
	);
}
