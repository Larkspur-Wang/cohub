import type { SessionRecord, SessionTurnRecord } from "@neta-art/cohub";
import { mergeSessionRecord } from "$lib/session-record-merge";
import { sortSessionsByRecentActivity } from "$lib/session-sort";

export type SessionViewState = {
	session: SessionRecord | undefined;
	turns: SessionTurnRecord[];
	loading: boolean;
	loaded: boolean;
	error: string;
	hasMore: boolean;
	hasMoreNewer: boolean;
	loadingOlder: boolean;
	loadingNewer: boolean;
	oldestCursor: number | undefined;
};

type UpsertOptions = {
	cache?: boolean;
};

export function createSessionWorkspaceController() {
	let spaceSessions = $state<SessionRecord[]>([]);
	let sessionStateById = $state<Record<string, SessionViewState>>({});
	let activeSessionId = $state<string | null>(null);
	let loadingSessionIds = $state<Record<string, boolean>>({});
	let visibleInitialLoadingSessionIds = $state<Record<string, boolean>>({});

	function initialSessionState(session?: SessionRecord): SessionViewState {
		return {
			session,
			turns: [],
			loading: true,
			loaded: false,
			error: "",
			hasMore: true,
			hasMoreNewer: false,
			loadingOlder: false,
			loadingNewer: false,
			oldestCursor: undefined,
		};
	}

	function upsertSessionRecord(
		session: SessionRecord,
		_options?: UpsertOptions,
	) {
		const existingSession = spaceSessions.find(
			(item) => item.id === session.id,
		);
		const nextSessions = sortSessionsByRecentActivity([
			mergeSessionRecord(existingSession, session),
			...spaceSessions.filter((item) => item.id !== session.id),
		]);
		spaceSessions = nextSessions;
		const existing = sessionStateById[session.id];
		sessionStateById = {
			...sessionStateById,
			[session.id]: {
				session,
				turns: existing?.turns ?? [],
				loading: existing?.loading ?? false,
				loaded: existing?.loaded ?? false,
				error: existing?.error ?? "",
				hasMore: existing?.hasMore ?? true,
				hasMoreNewer: existing?.hasMoreNewer ?? false,
				loadingOlder: existing?.loadingOlder ?? false,
				loadingNewer: existing?.loadingNewer ?? false,
				oldestCursor: existing?.oldestCursor,
			},
		};
		return nextSessions;
	}

	function applySessionRealtimeRecord(session: SessionRecord) {
		upsertSessionRecord(session);
	}

	function applySessionsSnapshot(sessions: SessionRecord[]) {
		const activeSession = activeSessionId
			? sessionStateById[activeSessionId]?.session
			: undefined;
		const nextSessions =
			activeSession &&
			!sessions.some((session) => session.id === activeSession.id)
				? sortSessionsByRecentActivity([activeSession, ...sessions])
				: sessions;
		spaceSessions = nextSessions;
		const nextState: Record<string, SessionViewState> = {};
		for (const session of nextSessions) {
			const existing = sessionStateById[session.id];
			nextState[session.id] = {
				session,
				turns: existing?.turns ?? [],
				loading: existing?.loading ?? false,
				loaded: existing?.loaded ?? false,
				error: existing?.error ?? "",
				hasMore: existing?.hasMore ?? true,
				hasMoreNewer: existing?.hasMoreNewer ?? false,
				loadingOlder: existing?.loadingOlder ?? false,
				loadingNewer: existing?.loadingNewer ?? false,
				oldestCursor: existing?.oldestCursor,
			};
		}
		if (
			activeSessionId &&
			sessionStateById[activeSessionId] &&
			!nextState[activeSessionId]
		) {
			nextState[activeSessionId] = sessionStateById[activeSessionId];
		}
		sessionStateById = nextState;
		return nextSessions;
	}

	function seedSessions(sessions: SessionRecord[]) {
		return applySessionsSnapshot(sessions);
	}

	function prepareRouteSession(sessionId: string) {
		activeSessionId = sessionId;
		if (!sessionStateById[sessionId]) {
			sessionStateById = {
				...sessionStateById,
				[sessionId]: initialSessionState(
					spaceSessions.find((session) => session.id === sessionId),
				),
			};
		}
	}

	function setSessionState(sessionId: string, state: SessionViewState) {
		sessionStateById = { ...sessionStateById, [sessionId]: state };
	}

	function patchSessionState(
		sessionId: string,
		updater: (current: SessionViewState | undefined) => SessionViewState,
	) {
		setSessionState(sessionId, updater(sessionStateById[sessionId]));
	}

	function reset() {
		spaceSessions = [];
		sessionStateById = {};
		activeSessionId = null;
		loadingSessionIds = {};
		visibleInitialLoadingSessionIds = {};
	}

	return {
		get spaceSessions() {
			return spaceSessions;
		},
		set spaceSessions(value: SessionRecord[]) {
			spaceSessions = value;
		},
		get sessionStateById() {
			return sessionStateById;
		},
		set sessionStateById(value: Record<string, SessionViewState>) {
			sessionStateById = value;
		},
		get activeSessionId() {
			return activeSessionId;
		},
		set activeSessionId(value: string | null) {
			activeSessionId = value;
		},
		get loadingSessionIds() {
			return loadingSessionIds;
		},
		set loadingSessionIds(value: Record<string, boolean>) {
			loadingSessionIds = value;
		},
		get visibleInitialLoadingSessionIds() {
			return visibleInitialLoadingSessionIds;
		},
		set visibleInitialLoadingSessionIds(value: Record<string, boolean>) {
			visibleInitialLoadingSessionIds = value;
		},
		upsertSessionRecord,
		applySessionRealtimeRecord,
		applySessionsSnapshot,
		seedSessions,
		prepareRouteSession,
		setSessionState,
		patchSessionState,
		reset,
	};
}
