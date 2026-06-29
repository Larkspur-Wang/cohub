<script lang="ts">
import type { SpacePresenceUser } from "@neta-art/cohub";
import { onMount } from "svelte";
import UserAvatar from "$lib/components/UserAvatar.svelte";
import { displayUserName } from "../space-utils";

type Props = {
	users: SpacePresenceUser[];
	limit?: number;
};

let { users, limit = 4 }: Props = $props();

let rootEl = $state<HTMLDivElement | null>(null);
let open = $state(false);

const visibleUsers = $derived(users.slice(0, limit));
const firstUser = $derived(users[0]);
const overflowCount = $derived(Math.max(0, users.length - visibleUsers.length));
const itemPriority = (item: Record<string, unknown>) => {
	if (item.kind === "session") return 0;
	if (item.kind === "file") return 1;
	return 2;
};

function getPanels(user: SpacePresenceUser) {
	const directPanels = Array.isArray(user.meta?.panels)
		? user.meta.panels.filter((panel): panel is Record<string, unknown> =>
				Boolean(panel && typeof panel === "object" && !Array.isArray(panel)),
			)
		: [];
	const aggregatedPanels = user.metas.flatMap((meta) =>
		Array.isArray(meta?.panels)
			? meta.panels.filter((panel): panel is Record<string, unknown> =>
					Boolean(panel && typeof panel === "object" && !Array.isArray(panel)),
				)
			: [],
	);
	return [...directPanels, ...aggregatedPanels];
}

const locationLabel = (user: SpacePresenceUser) => {
	const panels = getPanels(user);
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
	if (kind === "checkpoint") return "reviewing a save";
	if (kind === "task") return "on a task";
	if (kind === "work") return "in a work";
	if (kind === "cronjob") return "checking a cronjob";
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

const peopleLabel = $derived(users.length === 1 ? "person" : "people");
const popoverTitle = $derived(`${users.length} ${peopleLabel} online`);
const desktopCountVisible = $derived(overflowCount > 0);
const mobileCountVisible = $derived(users.length > 1);

function toggleOpen() {
	open = !open;
}

onMount(() => {
	const handlePointerDown = (event: PointerEvent) => {
		if (!open || !rootEl) return;
		const target = event.target as Node | null;
		if (target && rootEl.contains(target)) return;
		open = false;
	};
	const handleKeyDown = (event: KeyboardEvent) => {
		if (event.key === "Escape") open = false;
	};
	document.addEventListener("pointerdown", handlePointerDown, true);
	window.addEventListener("keydown", handleKeyDown);
	return () => {
		document.removeEventListener("pointerdown", handlePointerDown, true);
		window.removeEventListener("keydown", handleKeyDown);
	};
});

$effect(() => {
	if (users.length === 0) open = false;
});
</script>

{#if users.length > 0}
	<div bind:this={rootEl} class="presence-root">
		<button
			type="button"
			class="presence-stack"
			onclick={toggleOpen}
			aria-haspopup="dialog"
			aria-expanded={open}
			aria-label={title}
		>
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
			{#if desktopCountVisible}
				<span class="presence-count presence-count-desktop">{users.length}</span>
			{/if}
			{#if mobileCountVisible}
				<span class="presence-count presence-count-mobile">{users.length}</span>
			{/if}
		</button>

		{#if open}
			<div class="presence-popover" role="dialog" aria-label={popoverTitle}>
				<div class="presence-popover-header">
					<span class="presence-popover-title">Online</span>
					<span class="presence-popover-meta">{users.length} {peopleLabel}</span>
				</div>
				<div class="presence-popover-list" role="list">
					{#each users as user (user.userId)}
						{@const panels = getPanels(user)}
						{@const primaryPanel = [...panels].sort((a, b) => itemPriority(a) - itemPriority(b))[0]}
						{@const label = typeof primaryPanel?.label === "string" ? primaryPanel.label.trim() : ""}
						{@const kind = typeof primaryPanel?.kind === "string" ? primaryPanel.kind.trim() : ""}
						<div class="presence-row" role="listitem">
							<UserAvatar
								name={displayUserName(user.profile, user.userId)}
								avatarUrl={user.profile.avatarUrl}
								size="sm"
								/>
							<div class="presence-row-body">
								<div class="presence-row-name">{displayUserName(user.profile, user.userId)}</div>
								<div class="presence-row-subtitle">
									<span>{label || (kind === "session" ? "in a chat" : kind === "file" ? "in a file" : kind === "checkpoint" ? "reviewing a save" : kind === "task" ? "on a task" : kind === "work" ? "in a work" : kind === "cronjob" ? "checking a cronjob" : "in this space")}</span>
									{#if panels.length > 1}
										<span>· {panels.length} panels</span>
									{/if}
								</div>
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	</div>
{/if}

<style>
	.presence-root {
		position: relative;
		flex: 0 0 auto;
	}

	.presence-stack {
		display: inline-flex;
		height: 24px;
		align-items: center;
		gap: 4px;
		border-radius: 999px;
		border: 0;
		background: transparent;
		padding: 0 5px 0 4px;
		color: var(--text-tertiary);
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease, transform 120ms ease;
	}

	.presence-stack:hover,
	.presence-stack[aria-expanded="true"] {
		background: var(--bg-hover);
		color: var(--text-secondary);
	}

	.presence-stack:active {
		transform: translateY(0.5px);
	}

	.presence-stack:focus-visible {
		outline: 2px solid color-mix(in srgb, var(--brand) 38%, transparent);
		outline-offset: 1px;
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
		align-items: center;
	}

	.presence-count {
		font-size: 11px;
		font-weight: 550;
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}

	.presence-count-mobile {
		display: none;
	}

	.presence-popover {
		position: absolute;
		right: 0;
		top: calc(100% + 8px);
		z-index: 80;
		width: min(280px, calc(100vw - 24px));
		overflow: hidden;
		border: 1px solid var(--border-subtle);
		border-radius: 14px;
		background: var(--bg-elevated);
		box-shadow: 0 18px 32px color-mix(in srgb, var(--overlay-scrim-strong) 12%, transparent);
	}

	.presence-popover-header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		border-bottom: 1px solid var(--border-subtle);
		padding: 8px 10px 7px;
	}

	.presence-popover-title {
		font-size: 11px;
		font-weight: 650;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: var(--text-secondary);
	}

	.presence-popover-meta {
		font-size: 11px;
		color: var(--text-tertiary);
		font-variant-numeric: tabular-nums;
	}

	.presence-popover-list {
		max-height: min(280px, calc(100vh - 140px));
		overflow: auto;
		padding: 4px;
	}

	.presence-row {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: center;
		gap: 8px;
		border-radius: 10px;
		padding: 7px 8px;
	}

	.presence-row:hover {
		background: var(--bg-hover);
	}

	.presence-row-body {
		min-width: 0;
		display: grid;
		gap: 2px;
	}

	.presence-row-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 13px;
		font-weight: 550;
		color: var(--text-primary);
	}

	.presence-row-subtitle {
		display: flex;
		min-width: 0;
		gap: 6px;
		overflow: hidden;
		font-size: 11px;
		line-height: 1.2;
		color: var(--text-tertiary);
	}

	.presence-row-subtitle span:first-child {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	@media (max-width: 640px) {
		.presence-stack {
			gap: 4px;
			padding: 0 5px 0 3px;
		}

		.presence-dot,
		.presence-avatars {
			display: none;
		}

		.presence-mobile-avatar {
			display: inline-flex;
		}

		.presence-count-desktop {
			display: none;
		}

		.presence-count-mobile {
			display: inline-flex;
		}

		.presence-popover {
			position: fixed;
			left: 8px;
			right: 8px;
			top: auto;
			bottom: 8px;
			width: auto;
			max-width: none;
			border-radius: 18px 18px 14px 14px;
		}

		.presence-popover-header {
			padding: 10px 12px 8px;
		}

		.presence-popover-list {
			max-height: min(52vh, calc(100vh - 92px));
			padding: 6px;
		}

		.presence-row {
			gap: 10px;
			padding: 9px 10px;
		}

		.presence-row-subtitle {
			font-size: 10px;
		}
	}
</style>
