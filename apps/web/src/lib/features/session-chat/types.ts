import type { ViewportContext } from "@cohub/protocol";
import type { ChannelEnvelope } from "@cohub/protocol/realtime";
import type { SessionRecord } from "@neta-art/cohub";
import type { WorkspaceFileLinkTarget } from "$lib/workspace-file-links";
import type {
	ActiveViewportSource,
	CanvasViewportObservation,
} from "./viewport-context-controller.svelte";

/** Discriminated chat route — no contradictory fields. */
export type SessionChatRoute =
	| { kind: "none" }
	| { kind: "new" }
	| { kind: "session"; sessionId: string; turnSequence: number | null };

export type SessionChatAccess = {
	spaceLoadError: string;
	spaceHasMinimalAccess: boolean;
	canCreateSession: boolean;
	bootstrapping: boolean;
};

export type SessionChatContext = {
	spaceId: string;
	route: SessionChatRoute;
	access: SessionChatAccess;
};

/** Stable environment ports — set at host construction, not route snapshots. */
export type SessionChatEnvironment = {
	openPath: (target: string | WorkspaceFileLinkTarget) => void | Promise<void>;
	router: {
		toSession: (
			sessionId: string,
			opts?: { replace?: boolean },
		) => Promise<void>;
		toTurn: (sessionId: string, sequence: number) => Promise<void>;
		toNewSession: (opts?: { replace?: boolean }) => Promise<void>;
	};
};

export type SelectedModel = {
	provider: string;
	id: string;
	name?: string;
};

/**
 * Shell-facing handle — intentionally small.
 * DOM refs, scroll metrics, and internal loaders stay off this surface.
 */
export type SessionChatHandle = {
	readonly sessions: readonly SessionRecord[];
	readonly activeSessionId: string | null;
	readonly activeSession: SessionRecord | undefined;

	enterSpace(spaceId: string): void;
	syncContext(input: SessionChatContext): void;

	ingestRealtimeEnvelope(envelope: ChannelEnvelope): void;
	onTransportOpen(): void;
	onConnectionRecovered(): void;
	onVisibilityChanged(visible: boolean): void;

	reportActiveSource(source: ActiveViewportSource): void;
	reportFileVisibleLines(
		path: string,
		range: { start: number; end: number } | null,
	): void;
	reportCanvasView(state: CanvasViewportObservation): void;

	insertComposerText(snippet: string): void;
	flushComposerDraft(): void;

	/** Space-level session list refresh (Shell may trigger on visibility). */
	refreshSessions(force?: boolean): Promise<void>;

	/** Header rename / share helpers still used by Space chrome. */
	renameActiveSession(title: string): Promise<SessionRecord | null>;
	getSessionById(sessionId: string): SessionRecord | undefined;

	dispose(): void;
};

export type SessionChatViewportReport = {
	contexts: ViewportContext[];
};
