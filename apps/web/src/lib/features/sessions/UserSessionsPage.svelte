<script lang="ts">
import type { SessionRecord, UserSessionListItem } from "@neta-art/cohub";
import { onDestroy, onMount, untrack } from "svelte";
import { goto } from "$app/navigation";
import { createSessionChatHost } from "$lib/features/session-chat/session-chat-host.controller.svelte";
import { subscribeSpaceChannel } from "$lib/features/session-chat/space-channel";
import SessionConversationPanel from "$lib/features/sessions/SessionConversationPanel.svelte";
import UserSessionsList from "$lib/features/sessions/UserSessionsList.svelte";
import { createUserSessionListController } from "$lib/features/sessions/user-session-list-controller.svelte";
import {
	type WorkspacePreviewRef,
	withPreviewParam,
} from "$lib/features/space/modules/workspace-preview-route";
import { DESKTOP_SHELL_MIN_WIDTH_PX } from "$lib/layout/breakpoints";
import { sdk } from "$lib/sdk";
import {
	buildSessionsRoute,
	buildSpaceNewSessionRoute,
	buildSpaceSessionRoute,
	buildSpaceSessionTurnRoute,
	buildUserSessionRoute,
} from "$lib/space-routes";
import { authStore } from "$lib/stores/auth.svelte";
import { modelsCatalogStore } from "$lib/stores/models-catalog.svelte";
import { getRecentSpaces } from "$lib/stores/recent-space";
import { fetchSpaceListWithCache } from "$lib/stores/space-list-cache";
import type { WorkspaceFileLinkTarget } from "$lib/workspace-file-links";

const {
	data,
}: {
	data: {
		sessionId?: string | null;
	};
} = $props();

const list = createUserSessionListController();

/** Mutable space identity for host environment ports (set before syncContext). */
const spaceBox = { current: "" as string };
const connectionBox: {
	current: "idle" | "connecting" | "reconnecting" | "open" | "closed" | "error";
} = { current: "open" };

function resolveOpenPathTarget(
	target: string | WorkspaceFileLinkTarget,
): string | null {
	if (typeof target === "string") {
		const trimmed = target.trim();
		return trimmed || null;
	}
	if (target && typeof target === "object" && "path" in target) {
		const path = String((target as { path?: unknown }).path ?? "").trim();
		return path || null;
	}
	return null;
}

const sessionChat = createSessionChatHost({
	openPath: async (target) => {
		const spaceId = spaceBox.current;
		const path = resolveOpenPathTarget(target);
		const sessionId = sessionChat.activeSessionId;
		if (!spaceId || !path || !sessionId) return;
		const preview: WorkspacePreviewRef = { kind: "file", key: path };
		const href = withPreviewParam(
			buildSpaceSessionRoute(spaceId, sessionId),
			null,
			preview,
		);
		await goto(href);
	},
	router: {
		toSession: async (sessionId, opts) => {
			await goto(buildUserSessionRoute(sessionId), {
				replaceState: opts?.replace ?? true,
				keepFocus: true,
				noScroll: true,
			});
		},
		toTurn: async (sessionId, sequence) => {
			const spaceId = spaceBox.current;
			if (!spaceId) {
				await goto(buildUserSessionRoute(sessionId), {
					replaceState: true,
					keepFocus: true,
					noScroll: true,
				});
				return;
			}
			await goto(buildSpaceSessionTurnRoute(spaceId, sessionId, sequence), {
				replaceState: true,
				keepFocus: true,
				noScroll: true,
			});
		},
		toNewSession: async () => {
			await handleNewChat();
		},
	},
	getConnectionState: () => connectionBox.current,
	hasSpace: () => Boolean(spaceBox.current),
});

let isDesktop = $state(true);
let creating = $state(false);
let unsubscribeCache: (() => void) | null = null;
let unsubscribeRealtime: (() => void) | null = null;
let openSeq = 0;

const routeSessionId = $derived(data.sessionId ?? null);
const activeSeed = $derived(
	routeSessionId ? list.findById(routeSessionId) : null,
);

function updateViewport() {
	isDesktop = window.innerWidth >= DESKTOP_SHELL_MIN_WIDTH_PX;
}

function isCurrentOpen(seq: number, sessionId: string | null) {
	return seq === openSeq && (data.sessionId ?? null) === sessionId;
}

function accessForSessions() {
	return {
		spaceLoadError: "",
		spaceHasMinimalAccess: false,
		canCreateSession: true,
		bootstrapping: false,
	};
}

async function openChatSession(input: {
	spaceId: string;
	sessionId: string;
	session?: SessionRecord | null;
}) {
	const { spaceId, sessionId, session } = input;
	spaceBox.current = spaceId;
	sessionChat.enterSpace(spaceId);
	if (session) {
		sessionChat.upsertSessionRecord(session);
	}
	sessionChat.syncContext({
		spaceId,
		route: { kind: "session", sessionId, turnSequence: null },
		access: accessForSessions(),
	});
}

function clearChatSession() {
	const spaceId = spaceBox.current;
	if (!spaceId) {
		sessionChat.syncContext({
			spaceId: "",
			route: { kind: "none" },
			access: accessForSessions(),
		});
		return;
	}
	sessionChat.syncContext({
		spaceId,
		route: { kind: "none" },
		access: accessForSessions(),
	});
}

async function selectSession(session: UserSessionListItem) {
	if (!isDesktop) {
		await goto(buildSpaceSessionRoute(session.spaceId, session.id));
		return;
	}
	await goto(buildUserSessionRoute(session.id), {
		keepFocus: true,
		noScroll: true,
	});
}

async function openRouteSession(sessionId: string | null) {
	const seq = ++openSeq;
	if (!sessionId) {
		if (isCurrentOpen(seq, null)) clearChatSession();
		return;
	}

	if (!isDesktop) {
		const known = list.findById(sessionId);
		if (known) {
			if (!isCurrentOpen(seq, sessionId)) return;
			await goto(buildSpaceSessionRoute(known.spaceId, sessionId), {
				replaceState: true,
			});
			return;
		}
		try {
			const detail = await sdk.user.getSession(sessionId);
			if (!isCurrentOpen(seq, sessionId)) return;
			await goto(buildSpaceSessionRoute(detail.session.spaceId, sessionId), {
				replaceState: true,
			});
		} catch (error) {
			if (!isCurrentOpen(seq, sessionId)) return;
			console.warn("[sessions] failed to resolve mobile session", error);
			await goto(buildSessionsRoute(), { replaceState: true });
		}
		return;
	}

	const known = list.findById(sessionId);
	if (known) {
		if (!isCurrentOpen(seq, sessionId)) return;
		await openChatSession({
			spaceId: known.spaceId,
			sessionId: known.id,
			session: known,
		});
		return;
	}

	try {
		const detail = await sdk.user.getSession(sessionId);
		if (!isCurrentOpen(seq, sessionId)) return;
		list.upsertSession({
			...detail.session,
			space: {
				id: detail.space.id,
				name: detail.space.name ?? detail.space.title ?? "Space",
				slug: detail.space.slug ?? null,
				publicProfile: detail.space.publicProfile ?? null,
			},
		});
		if (!isCurrentOpen(seq, sessionId)) return;
		await openChatSession({
			spaceId: detail.session.spaceId,
			sessionId: detail.session.id,
			session: detail.session,
		});
	} catch (error) {
		if (!isCurrentOpen(seq, sessionId)) return;
		console.warn("[sessions] failed to open session", error);
	}
}

async function handleNewChat() {
	if (creating) return;
	creating = true;
	try {
		const userUuid = authStore.userUuid;
		const recent = userUuid ? getRecentSpaces(userUuid) : [];
		const spaces = await fetchSpaceListWithCache(
			async () => await sdk.spaces.list(),
		);
		const preferred =
			spaces.find((space) => space.id === recent[0]?.spaceId) ??
			spaces[0] ??
			null;
		if (!preferred) {
			await goto("/spaces/new");
			return;
		}
		await goto(buildSpaceNewSessionRoute(preferred.id));
	} catch (error) {
		console.warn("[sessions] failed to start new chat", error);
		await goto("/spaces/new");
	} finally {
		creating = false;
	}
}

// Keep the left list in sync when host mutates the active session record.
$effect(() => {
	const session = sessionChat.activeSession;
	if (!session) return;
	const existing = list.findById(session.id);
	list.upsertSession({
		...session,
		space: existing?.space ?? null,
	} as UserSessionListItem);
});

$effect(() => {
	const sessionId = routeSessionId;
	// openRouteSession reads list state and writes chat host state.
	// Untrack to avoid effect_update_depth_exceeded.
	untrack(() => {
		void openRouteSession(sessionId);
	});
});

// One shared space room per active space (refcount with Space page if both open).
// Switching sessions inside the same space does not open a second subscription.
$effect(() => {
	const spaceId = sessionChat.spaceId;
	const sessionId = sessionChat.activeSessionId;
	if (!spaceId || !sessionId) return;
	return subscribeSpaceChannel(spaceId, (event) => {
		void sessionChat.ingestRealtimeEnvelope(event);
	});
});

onMount(() => {
	updateViewport();
	window.addEventListener("resize", updateViewport);
	unsubscribeCache = list.subscribeCache();
	unsubscribeRealtime = list.subscribeRealtime();
	void list.hydrateFromCache().then(() => list.refresh());
	void modelsCatalogStore.load().catch(() => undefined);
	const onVisible = () => {
		if (document.visibilityState === "visible") {
			void list.refresh({ force: true });
			sessionChat.onVisibilityChanged(true);
		} else {
			sessionChat.onVisibilityChanged(false);
		}
	};
	document.addEventListener("visibilitychange", onVisible);
	return () => {
		window.removeEventListener("resize", updateViewport);
		document.removeEventListener("visibilitychange", onVisible);
	};
});

onDestroy(() => {
	unsubscribeCache?.();
	unsubscribeRealtime?.();
	sessionChat.dispose();
});
</script>

<svelte:head>
	<title>Chats · Cohub</title>
</svelte:head>

<div class="flex h-full min-h-0 w-full overflow-hidden bg-bg-primary">
	<div
		class="min-h-0 shrink-0 overflow-hidden border-r border-border-subtle"
		class:w-full={!isDesktop}
		class:w-[320px]={isDesktop}
		class:max-w-[360px]={isDesktop}
	>
		<UserSessionsList
			sessions={list.sessions}
			activeSessionId={isDesktop ? routeSessionId : null}
			loading={list.loading}
			loadingMore={list.loadingMore}
			refreshing={list.refreshing}
			error={list.error}
			hasMore={list.pageInfo.hasMore}
			{isDesktop}
			modelsCatalog={modelsCatalogStore.items ?? null}
			onSelect={(session) => {
				void selectSession(session);
			}}
			onLoadMore={() => {
				void list.loadMore();
			}}
			onNewChat={() => {
				void handleNewChat();
			}}
		/>
	</div>

	{#if isDesktop}
		<div class="min-h-0 min-w-0 flex-1 overflow-hidden">
			<SessionConversationPanel host={sessionChat} seed={activeSeed} />
		</div>
	{/if}
</div>
