<script lang="ts">
/**
 * Desktop sessions host panel: space chrome header + full SessionChatPanel.
 */
import type { UserSessionListItem } from "@neta-art/cohub";
import { ArrowUpRight } from "lucide-svelte";
import SpaceAvatar from "$lib/components/SpaceAvatar.svelte";
import {
	getSessionTitle,
	type SessionChatHost,
} from "$lib/features/session-chat";
import SessionChatPanel from "$lib/features/session-chat/SessionChatPanel.svelte";
import { buildSpaceSessionRoute } from "$lib/space-routes";

const {
	host,
	seed = null,
}: {
	host: SessionChatHost;
	seed?: UserSessionListItem | null;
} = $props();

const session = $derived(host.activeSession ?? seed ?? null);
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
const hasSession = $derived(Boolean(host.activeSessionId));
</script>

<section class="flex h-full min-h-0 flex-col bg-bg-content">
	{#if !hasSession}
		<div
			class="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center"
		>
			<p class="text-[14px] text-text-secondary">Select a chat</p>
			<p class="text-[12px] text-text-placeholder">
				Your recent conversations across spaces appear on the left.
			</p>
		</div>
	{:else}
		<header
			class="flex shrink-0 items-center gap-2 border-b border-border-subtle px-4 py-2.5"
		>
			{#if seed?.space}
				<SpaceAvatar
					name={spaceName || seed.space.name}
					profile={seed.space.publicProfile ?? null}
					size="sm"
				/>
			{/if}
			<div class="min-w-0 flex-1">
				<div class="truncate text-[13px] font-medium text-text-primary">
					{title}
				</div>
				{#if spaceName}
					<div class="truncate text-[11px] text-text-placeholder">
						{spaceName}
					</div>
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
		<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
			<SessionChatPanel {host} />
		</div>
	{/if}
</section>
