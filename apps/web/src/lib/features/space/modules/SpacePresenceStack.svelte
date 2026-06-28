<script lang="ts">
import type { SpacePresenceUser } from "@neta-art/cohub";
import UserAvatar from "$lib/components/UserAvatar.svelte";
import { displayUserName } from "../space-utils";

type Props = {
	users: SpacePresenceUser[];
	limit?: number;
};

let { users, limit = 4 }: Props = $props();

const visibleUsers = $derived(users.slice(0, limit));
const firstUser = $derived(users[0]);
const overflowCount = $derived(Math.max(0, users.length - visibleUsers.length));
const itemPriority = (item: Record<string, unknown>) => {
	if (item.kind === "session") return 0;
	if (item.kind === "file") return 1;
	return 2;
};

const locationLabel = (user: SpacePresenceUser) => {
	const meta = user.meta;
	const panels = Array.isArray(meta?.panels)
		? meta.panels.filter((panel): panel is Record<string, unknown> =>
				Boolean(panel && typeof panel === "object" && !Array.isArray(panel)),
			)
		: [];
	const primaryItem = [...panels].sort(
		(a, b) => itemPriority(a) - itemPriority(b),
	)[0];
	const label =
		typeof primaryItem?.label === "string" ? primaryItem.label.trim() : "";
	const kind =
		typeof primaryItem?.kind === "string" ? primaryItem.kind.trim() : "";
	if (label) return `in ${label}`;
	if (kind === "session") return "in a chat";
	if (kind === "file") return "in a file";
	return "in this space";
};

const title = $derived.by(() => {
	if (users.length === 0) return "No one online";
	const names = users.slice(0, 6).map((user) => {
		const name = displayUserName(user.profile, user.userId);
		return `${name} ${locationLabel(user)}`;
	});
	const suffix =
		users.length > names.length
			? ` and ${users.length - names.length} more`
			: "";
	return `${names.join(", ")}${suffix} online`;
});
</script>

{#if users.length > 0}
	<div class="presence-stack" title={title} aria-label={title}>
		<span class="presence-dot" aria-hidden="true"></span>
		<div class="presence-avatars" aria-hidden="true">
			{#each visibleUsers as user (user.userId)}
				<UserAvatar
					name={displayUserName(user.profile, user.userId)}
					avatarUrl={user.profile.avatarUrl}
					size="xxs"
					class="presence-avatar"
				/>
			{/each}
			{#if overflowCount > 0}
				<span class="presence-overflow">+{overflowCount}</span>
			{/if}
		</div>
		<div class="presence-mobile-avatar" aria-hidden="true">
			{#if firstUser}
				<UserAvatar
					name={displayUserName(firstUser.profile, firstUser.userId)}
					avatarUrl={firstUser.profile.avatarUrl}
					size="xxs"
					class="border-bg-elevated"
				/>
			{/if}
		</div>
		<span class="presence-count">{users.length}</span>
	</div>
{/if}

<style>
	.presence-stack {
		display: inline-flex;
		min-height: 24px;
		align-items: center;
		gap: 5px;
		border-radius: 999px;
		padding: 2px 5px 2px 4px;
		color: var(--text-tertiary);
		transition: background-color 120ms ease, color 120ms ease;
	}

	.presence-stack:hover {
		background: var(--bg-hover);
		color: var(--text-secondary);
	}

	.presence-dot {
		height: 6px;
		width: 6px;
		flex: 0 0 auto;
		border-radius: 999px;
		background: var(--success-soft);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--success-soft) 14%, transparent);
	}

	.presence-avatars {
		display: inline-flex;
		align-items: center;
		padding-left: 2px;
	}

	:global(.presence-avatar) {
		margin-left: -3px;
		border-color: var(--bg-elevated);
		box-shadow: 0 0 0 1px var(--bg-elevated);
	}

	:global(.presence-avatar:first-child) {
		margin-left: 0;
	}

	.presence-overflow {
		margin-left: -3px;
		display: inline-flex;
		height: 16px;
		min-width: 16px;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		border: 1px solid var(--bg-elevated);
		background: var(--bg-hover-strong);
		padding: 0 4px;
		font-size: 8px;
		font-weight: 650;
		line-height: 1;
		color: var(--text-tertiary);
		box-shadow: 0 0 0 1px var(--bg-elevated);
	}

	.presence-mobile-avatar {
		display: none;
	}

	.presence-count {
		font-size: 11px;
		font-weight: 550;
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}

	@media (max-width: 640px) {
		.presence-stack {
			gap: 4px;
			padding-right: 5px;
		}

		.presence-avatars {
			display: none;
		}

		.presence-mobile-avatar {
			display: inline-flex;
		}
	}
</style>
