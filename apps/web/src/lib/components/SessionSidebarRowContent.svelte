<script lang="ts">
import type { SessionRecord } from "@neta-art/cohub";
import { getSessionSidebarActivity } from "$lib/session-sidebar-activity";
import { getSessionActivityAt } from "$lib/session-sort";
import { sessionGenerationStore } from "$lib/stores/session-generation.svelte";
import { unreadTracker } from "$lib/stores/session-state.svelte";
import { formatCompactAbsoluteTime } from "$lib/time-format";

const {
	session,
	title,
	isMobile = false,
}: {
	session: SessionRecord;
	title: string;
	isMobile?: boolean;
} = $props();

const activity = $derived(
	getSessionSidebarActivity(sessionGenerationStore.get(session.id)),
);
const badge = $derived(activity.active ? "" : sourceBadge(session.source));
const participantLabel = $derived(getSessionParticipantLabel(session));
const activityTime = $derived(
	formatCompactAbsoluteTime(getSessionActivityAt(session)),
);
const activityClass = $derived.by(() => {
	if (activity.phase === "failed") return "text-error-soft";
	if (activity.active) return "text-text-secondary";
	return "text-text-placeholder";
});

function sourceBadge(source: string | null): string {
	if (!source || source === "web") return "";
	const idx = source.indexOf(":");
	return idx > 0 ? source.slice(0, idx) : source;
}

function getSessionParticipantLabel(session: SessionRecord) {
	const names: string[] = [];
	const seen = new Set<string>();
	const addName = (
		userUuid: string | null | undefined,
		displayName: string | null | undefined,
	) => {
		const name = displayName?.trim();
		if (!name) return;
		const key = userUuid?.trim() || name.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		names.push(name);
	};
	addName(
		session.userProfile?.userUuid ?? session.userUuid,
		session.userProfile?.displayName,
	);
	for (const profile of session.participantProfiles ?? []) {
		addName(profile.userUuid, profile.displayName);
	}
	if (names.length === 0) return "unknown";
	if (names.length === 1) return names[0] ?? "unknown";
	return `${names[0]} +${names.length - 1}`;
}
</script>

<span class="min-w-0 flex flex-1 flex-col gap-0.5 overflow-hidden leading-tight">
	<span class="flex min-w-0 items-baseline gap-2">
		<span class="min-w-0 flex-1 truncate">{title}</span>
		<span class="shrink-0 tabular-nums text-[10px] font-normal text-text-placeholder">{activityTime}</span>
	</span>
	<span class="flex min-w-0 items-center gap-1.5 text-[10.5px] font-normal text-text-tertiary">
		<span class="max-w-[42%] shrink-0 truncate">{participantLabel}</span>
		<span class="text-text-placeholder">·</span>
		<span class="min-w-0 flex-1 truncate {activityClass}" title={activity.text ? `${activity.label} · ${activity.text}` : activity.label}>
			{activity.label}{#if activity.text} · {activity.text}{/if}{#if activity.active}<span class="session-activity-caret">▍</span>{/if}
		</span>
	</span>
</span>
{#if badge}
	<span class="absolute right-2 top-2 rounded-[3px] bg-bg-hover-strong px-1.5 py-px text-[10px] font-medium leading-none text-text-tertiary {isMobile ? '' : 'group-hover/session:opacity-0 group-focus-within/session:opacity-0'}">
		{badge}
	</span>
{/if}
{#if unreadTracker.isUnread(session, session.lastMessageId) && !activity.active}
	<span class="absolute right-3 top-2.5 h-[6px] w-[6px] rounded-full bg-brand {isMobile ? '' : 'group-hover/session:opacity-0 group-focus-within/session:opacity-0'}" title="Unread"></span>
{/if}
