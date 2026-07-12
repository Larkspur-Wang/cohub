<script lang="ts">
import type { UserSessionListItem } from "@neta-art/cohub";
import { onDestroy, onMount } from "svelte";
import { goto } from "$app/navigation";
import SessionConversationPanel from "$lib/features/sessions/SessionConversationPanel.svelte";
import { createSessionConversationHostController } from "$lib/features/sessions/session-conversation-host-controller.svelte";
import UserSessionsList from "$lib/features/sessions/UserSessionsList.svelte";
import { createUserSessionListController } from "$lib/features/sessions/user-session-list-controller.svelte";
import { DESKTOP_SHELL_MIN_WIDTH_PX } from "$lib/layout/breakpoints";
import { sdk } from "$lib/sdk";
import {
	buildSessionsRoute,
	buildSpaceNewSessionRoute,
	buildSpaceSessionRoute,
	buildUserSessionRoute,
} from "$lib/space-routes";
import { authStore } from "$lib/stores/auth.svelte";
import { modelsCatalogStore } from "$lib/stores/models-catalog.svelte";
import { getRecentSpaces } from "$lib/stores/recent-space";
import { fetchSpaceListWithCache } from "$lib/stores/space-list-cache";

const {
	data,
}: {
	data: {
		sessionId?: string | null;
	};
} = $props();

const list = createUserSessionListController();
const host = createSessionConversationHostController({
	onSessionUpdated: (session) => {
		const existing = list.findById(session.id);
		list.upsertSession({
			...session,
			space: existing?.space ?? (session as UserSessionListItem).space ?? null,
		});
	},
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
		if (isCurrentOpen(seq, null)) host.clearSession();
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
		await host.openSession({
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
		await host.openSession({
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

$effect(() => {
	const sessionId = routeSessionId;
	void openRouteSession(sessionId);
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
	host.dispose();
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
			<SessionConversationPanel host={host} seed={activeSeed} />
		</div>
	{/if}
</div>
