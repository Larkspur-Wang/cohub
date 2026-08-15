import {
	type BoardViewport,
	clampZoom,
	normalizeViewport,
} from "@neta-art/cohub/board";

const STORAGE_PREFIX = "cohub:board:view-states";
const STORAGE_VERSION = 1;
const MAX_STATES = 100;

type BoardSurfaceSize = { width: number; height: number };

export type BoardViewPreference = {
	centerX: number;
	centerY: number;
	zoom: number;
	updatedAt: number;
};

type StoredBoardViewPreferences = {
	version: typeof STORAGE_VERSION;
	states: Record<string, BoardViewPreference>;
};

function storageKey(userKey: string) {
	return `${STORAGE_PREFIX}:${encodeURIComponent(userKey)}:v${STORAGE_VERSION}`;
}

function stateKey(spaceId: string, boardId: string) {
	return [spaceId, boardId].map(encodeURIComponent).join(":");
}

function browserStorage(): Storage | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
}

function validSurface(surface: BoardSurfaceSize) {
	return (
		Number.isFinite(surface.width) &&
		Number.isFinite(surface.height) &&
		surface.width > 0 &&
		surface.height > 0
	);
}

function parsePreference(value: unknown): BoardViewPreference | null {
	if (!value || typeof value !== "object") return null;
	const record = value as Partial<BoardViewPreference>;
	if (
		!Number.isFinite(record.centerX) ||
		!Number.isFinite(record.centerY) ||
		!Number.isFinite(record.zoom) ||
		!Number.isFinite(record.updatedAt)
	) {
		return null;
	}
	return {
		centerX: record.centerX as number,
		centerY: record.centerY as number,
		zoom: clampZoom(record.zoom as number),
		updatedAt: Math.max(0, record.updatedAt as number),
	};
}

function readStoredPreferences(
	userKey: string,
	storage: Storage,
): StoredBoardViewPreferences {
	try {
		const raw = storage.getItem(storageKey(userKey));
		if (!raw) return { version: STORAGE_VERSION, states: {} };
		const parsed = JSON.parse(raw) as Partial<StoredBoardViewPreferences>;
		if (parsed.version !== STORAGE_VERSION || !parsed.states) {
			return { version: STORAGE_VERSION, states: {} };
		}
		const states: Record<string, BoardViewPreference> = {};
		for (const [key, value] of Object.entries(parsed.states)) {
			const preference = parsePreference(value);
			if (preference) states[key] = preference;
		}
		return { version: STORAGE_VERSION, states };
	} catch {
		return { version: STORAGE_VERSION, states: {} };
	}
}

export function boardViewPreferenceFromCamera(
	camera: BoardViewport,
	surface: BoardSurfaceSize,
	updatedAt = Date.now(),
): BoardViewPreference | null {
	if (!validSurface(surface)) return null;
	const viewport = normalizeViewport(camera);
	return {
		centerX: (surface.width / 2 - viewport.x) / viewport.zoom,
		centerY: (surface.height / 2 - viewport.y) / viewport.zoom,
		zoom: viewport.zoom,
		updatedAt,
	};
}

export function cameraFromBoardViewPreference(
	preference: BoardViewPreference,
	surface: BoardSurfaceSize,
): BoardViewport | null {
	if (!validSurface(surface)) return null;
	const parsed = parsePreference(preference);
	if (!parsed) return null;
	return normalizeViewport({
		x: surface.width / 2 - parsed.centerX * parsed.zoom,
		y: surface.height / 2 - parsed.centerY * parsed.zoom,
		zoom: parsed.zoom,
	});
}

export function readBoardViewPreference(
	userKey: string,
	spaceId: string,
	boardId: string,
	storage = browserStorage(),
): BoardViewPreference | null {
	if (!storage) return null;
	return (
		readStoredPreferences(userKey, storage).states[
			stateKey(spaceId, boardId)
		] ?? null
	);
}

export function writeBoardViewPreference(
	userKey: string,
	spaceId: string,
	boardId: string,
	preference: BoardViewPreference,
	storage = browserStorage(),
) {
	if (!storage) return;
	const parsed = parsePreference(preference);
	if (!parsed) return;
	try {
		const stored = readStoredPreferences(userKey, storage);
		stored.states[stateKey(spaceId, boardId)] = parsed;
		const entries = Object.entries(stored.states).sort(
			([, a], [, b]) => b.updatedAt - a.updatedAt,
		);
		stored.states = Object.fromEntries(entries.slice(0, MAX_STATES));
		storage.setItem(storageKey(userKey), JSON.stringify(stored));
	} catch {
		// View preferences are best-effort and must never block Board interaction.
	}
}
