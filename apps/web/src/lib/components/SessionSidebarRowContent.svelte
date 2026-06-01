<script lang="ts">
import type { SessionRecord } from "@neta-art/cohub";
import { getSessionSidebarActivity } from "$lib/session-sidebar-activity";
import { getSessionActivityAt } from "$lib/session-sort";
import { sessionGenerationStore } from "$lib/stores/session-generation.svelte";
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
const participants = $derived(getSessionParticipants(session));
const participantLabel = $derived(getSessionParticipantLabel(participants));
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

type Participant = {
	key: string;
	name: string;
	avatarUrl: string | null;
};

function getInitials(name: string) {
	return (
		name
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase() ?? "")
			.join("") || "?"
	);
}

function getSessionParticipants(session: SessionRecord): Participant[] {
	const participants: Participant[] = [];
	const seen = new Set<string>();
	const addProfile = (
		profile:
			| {
					userUuid?: string | null;
					displayName?: string | null;
					avatarUrl?: string | null;
			  }
			| null
			| undefined,
	) => {
		const name = profile?.displayName?.trim();
		if (!name) return;
		const key = profile?.userUuid?.trim() || name.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		participants.push({ key, name, avatarUrl: profile?.avatarUrl ?? null });
	};
	addProfile(session.userProfile);
	for (const profile of session.participantProfiles ?? []) addProfile(profile);
	return participants;
}

function getSessionParticipantLabel(participants: Participant[]) {
	if (participants.length === 0) return "unknown";
	if (participants.length === 1) return participants[0]?.name ?? "unknown";
	return `${participants[0]?.name ?? "unknown"} +${participants.length - 1}`;
}
</script>

<span class="min-w-0 flex flex-1 flex-col gap-0.5 overflow-hidden leading-tight">
	<span class="flex min-w-0 items-baseline gap-2">
		<span class="min-w-0 flex-1 truncate">{title}</span>
		<span class="shrink-0 tabular-nums text-[10px] font-normal text-text-placeholder transition-opacity group-hover/session:opacity-0 group-focus-within/session:opacity-0">{activityTime}</span>
	</span>
	<span class="flex min-w-0 items-center gap-1.5 text-[10.5px] font-normal text-text-tertiary">
		<span class="inline-flex min-w-0 max-w-[48%] shrink-0 items-center gap-1.5 truncate" title={participantLabel}>
			<span class="inline-flex shrink-0 -space-x-1.5">
				{#each participants.slice(0, 3) as participant (participant.key)}
					{#if participant.avatarUrl}
						<img src={participant.avatarUrl} alt="" class="h-3.5 w-3.5 rounded-full border border-bg-primary object-cover" />
					{:else}
						<span class="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-bg-primary bg-bg-hover-strong text-[7px] font-medium text-text-tertiary">{getInitials(participant.name)}</span>
					{/if}
				{/each}
			</span>
			<span class="min-w-0 truncate">{participantLabel}</span>
		</span>
		{#if activity.active || activity.phase === "failed" || activity.phase === "interrupted"}
			<span class="text-text-placeholder">·</span>
			<span class="min-w-0 flex-1 truncate {activityClass}" title={activity.text ? `${activity.label} · ${activity.text}` : activity.label}>
				{activity.label}{#if activity.text} · {activity.text}{/if}{#if activity.active}<span class="session-activity-caret">▍</span>{/if}
			</span>
		{/if}
	</span>
</span>
{#if badge}
	<span class="absolute right-2 top-2 rounded-[3px] bg-bg-hover-strong px-1.5 py-px text-[10px] font-medium leading-none text-text-tertiary {isMobile ? '' : 'group-hover/session:opacity-0 group-focus-within/session:opacity-0'}">
		{badge}
	</span>
{/if}
