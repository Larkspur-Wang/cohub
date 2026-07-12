<script lang="ts">
import type { UserSessionListItem } from "@neta-art/cohub";
import { ArrowUpRight, Loader2 } from "lucide-svelte";
import AccessStateView from "$lib/components/AccessStateView.svelte";
import CenteredLoading from "$lib/components/CenteredLoading.svelte";
import ChatTimeline from "$lib/components/ChatTimeline.svelte";
import SessionComposer from "$lib/components/SessionComposer.svelte";
import SpaceAvatar from "$lib/components/SpaceAvatar.svelte";
import { getSessionTitle } from "$lib/features/space/modules/session-utils";
import { buildSpaceSessionRoute } from "$lib/space-routes";
import type { createSessionConversationHostController } from "./session-conversation-host-controller.svelte";

const {
	host,
	seed = null,
}: {
	host: ReturnType<typeof createSessionConversationHostController>;
	seed?: UserSessionListItem | null;
} = $props();

const state = $derived(host.activeState);
const session = $derived(state?.session ?? seed);
const title = $derived(session ? getSessionTitle(session) : "Chat");
const spaceName = $derived(
	seed?.space?.name?.trim() || (session ? "Space" : ""),
);
const spaceHref = $derived(
	session
		? buildSpaceSessionRoute(session.spaceId, session.id)
		: seed
			? buildSpaceSessionRoute(seed.spaceId, seed.id)
			: null,
);

let listEl = $state(null as HTMLDivElement | null);
let draft = $state("");
let draftSessionKey = $state(null as string | null);

$effect(() => {
	host.listEl = listEl;
});

$effect(() => {
	const key = host.activeSessionId
		? `${host.activeSpaceId ?? ""}:${host.activeSessionId}`
		: null;
	if (key !== draftSessionKey) {
		draftSessionKey = key;
		draft = host.input;
	}
});

$effect(() => {
	// Persist local composer text into host (draft storage + send payload).
	const value = draft;
	if (value !== host.input) host.input = value;
});
</script>

<section class="flex h-full min-h-0 flex-col bg-bg-content">
	{#if !host.activeSessionId}
		<div class="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
			<p class="text-[14px] text-text-secondary">Select a chat</p>
			<p class="text-[12px] text-text-placeholder">Your recent conversations across spaces appear on the left.</p>
		</div>
	{:else}
		<header class="flex shrink-0 items-center gap-2 border-b border-border-subtle px-4 py-2.5">
			{#if seed?.space}
				<SpaceAvatar
					name={spaceName || seed.space.name}
					profile={seed.space.publicProfile ?? null}
					size="sm"
				/>
			{/if}
			<div class="min-w-0 flex-1">
				<div class="truncate text-[13px] font-medium text-text-primary">{title}</div>
				{#if spaceName}
					<div class="truncate text-[11px] text-text-placeholder">{spaceName}</div>
				{/if}
			</div>
			{#if spaceHref}
				<a
					href={spaceHref}
					class="inline-flex h-7 items-center gap-1 rounded-[6px] px-2 text-[11px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
					title="Open in Space"
				>
					Open in Space
					<ArrowUpRight class="h-3 w-3" />
				</a>
			{/if}
		</header>

		<div class="relative min-h-0 flex-1">
			{#if state?.error && !state.loaded}
				<div class="p-4">
					<AccessStateView state={state.error} size="compact" />
				</div>
			{:else if state?.loading && !state.loaded && (state.turns?.length ?? 0) === 0}
				<CenteredLoading label="Loading chat…" />
			{:else}
				<div class="absolute inset-0 flex min-h-0 flex-col">
					<div class="min-h-0 flex-1 overflow-hidden">
						<ChatTimeline
							timeline={host.timeline}
							bind:bindListEl={listEl}
							loading={Boolean(state?.loading && !state?.loaded)}
							loadingOlder={Boolean(state?.loadingOlder)}
							onFirstVisible={() => {
								if (state?.hasMore && !state.loadingOlder) {
									void host.loadOlderTurns();
								}
							}}
						/>
					</div>
					{#if state?.error && state.loaded}
						<div class="px-4 pb-2">
							<AccessStateView state={state.error} size="compact" />
						</div>
					{/if}
					<div class="shrink-0 border-t border-border-subtle px-3 py-2">
						{#if host.composerNotice}
							<div class="mb-1.5 text-[11px] text-text-placeholder">{host.composerNotice}</div>
						{/if}
						<SessionComposer
							bind:value={draft}
							sending={host.sending}
							isRunning={host.activeSessionIsRunning}
							aborting={host.aborting}
							currentSpaceId={host.activeSpaceId}
							onsubmit={() => {
								void host.handleSend().then(() => {
									draft = host.input;
								});
							}}
							onabort={() => {
								void host.handleAbort();
							}}
						/>
					</div>
				</div>
			{/if}
			{#if state?.loading && state.loaded}
				<div class="pointer-events-none absolute right-3 top-3">
					<Loader2 class="h-3.5 w-3.5 animate-spin text-text-placeholder" />
				</div>
			{/if}
		</div>
	{/if}
</section>
