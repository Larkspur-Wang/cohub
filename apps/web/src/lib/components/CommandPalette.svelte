<script lang="ts">
import {
	CornerDownRight,
	FolderKanban,
	Loader2,
	MessageSquare,
	Plus,
	Search,
	TerminalSquare,
} from "lucide-svelte";
import { onMount, tick } from "svelte";
import { page } from "$app/state";
import { searchCommandItems } from "$lib/command-palette/commands";
import { getCommandPaletteDefaultItems } from "$lib/command-palette/default-items";
import { searchLocalCommandItems } from "$lib/command-palette/local-search";
import { mergeCommandResults } from "$lib/command-palette/merge-results";
import { parseCommandPaletteQuery } from "$lib/command-palette/query";
import {
	getRecentCommandItems,
	openCommandItem,
} from "$lib/command-palette/recent";
import { searchRemoteCommandItems } from "$lib/command-palette/remote-search";
import {
	getRemoteResourceTypes,
	typeLabelFor,
} from "$lib/command-palette/scope";
import type { CommandPaletteItem } from "$lib/command-palette/types";

const MIN_QUERY_LENGTH = 2;
const RESULT_LIMIT = 30;
const DEBOUNCE_MS = 180;
const POINTER_HOVER_ARM_MS = 220;
const DEFAULT_PLACEHOLDER =
	"Search turns, sessions, spaces… Try type:space or t:";

type OpenCommandPaletteDetail = {
	query?: string;
	placeholder?: string;
	title?: string;
};

let open = $state(false);
let query = $state("");
let title = $state("Command search");
let placeholder = $state(DEFAULT_PLACEHOLDER);
let inputEl = $state<HTMLInputElement | null>(null);
let resultsEl = $state<HTMLDivElement | null>(null);
let activeIndex = $state(0);
let settledItems = $state<CommandPaletteItem[]>([]);
let suppressPointerHover = $state(false);
let pointerHoverTimer: number | null = null;
let localItems = $state<CommandPaletteItem[]>([]);
let remoteItems = $state<import("@neta-art/cohub").GlobalSearchResult[]>([]);
let defaultItems = $state<CommandPaletteItem[]>([]);
let localDone = $state(true);
let remoteDone = $state(true);
let defaultDone = $state(true);
let remoteError = $state<string | null>(null);
let debounceTimer: number | null = null;
let localController: AbortController | null = null;
let remoteController: AbortController | null = null;
let searchToken = 0;

const currentSpaceId = $derived.by(() => {
	const match = page.url.pathname.match(/^\/spaces\/([^/]+)/);
	const id = match?.[1] ?? null;
	return id === "new" ? null : id;
});
const parsedQuery = $derived(parseCommandPaletteQuery(query));
const searchPlan = $derived({
	query: parsedQuery.query,
	resourceTypes: parsedQuery.resourceTypes,
});
const trimmedQuery = $derived(searchPlan.query.trim());
const typeLabel = $derived(typeLabelFor(searchPlan.resourceTypes));
const recentItems = $derived.by(() => {
	const items = getRecentCommandItems();
	if (!searchPlan.resourceTypes) return items;
	return items.filter((item) => searchPlan.resourceTypes?.includes(item.type));
});
const mergedItems = $derived.by(() => {
	if (trimmedQuery.length < MIN_QUERY_LENGTH) {
		return defaultItems.length > 0 ? defaultItems : recentItems;
	}
	return mergeCommandResults({
		local: [...localItems, ...searchCommandItems(searchPlan)],
		remote: remoteItems,
		limit: RESULT_LIMIT,
	});
});
const isSearching = $derived(!localDone || !remoteDone || !defaultDone);
const renderedItems = $derived(
	mergedItems.length > 0 || !isSearching ? mergedItems : settledItems,
);
const showingSettledItems = $derived(
	isSearching && mergedItems.length === 0 && settledItems.length > 0,
);
const statusText = $derived.by(() => {
	const label = typeLabel ?? "Turns, Sessions, Spaces, and Commands";
	if (trimmedQuery.length < MIN_QUERY_LENGTH) {
		return renderedItems.length > 0
			? `${label} · type to filter`
			: `Search ${label.toLowerCase()}`;
	}
	if (showingSettledItems) return `${label} · searching…`;
	if (remoteError) return `${label} · local results only · ${remoteError}`;
	if (!remoteDone)
		return `${label} · local ${localItems.length} · syncing server…`;
	if (!localDone) return `${label} · searching indexed cache…`;
	return `${label} · ${renderedItems.length} result${renderedItems.length === 1 ? "" : "s"} · indexed cache + server`;
});

function profileFor(item: CommandPaletteItem) {
	if (item.type !== "space") return null;
	return item.ownerProfile?.userUuid && item.ownerProfile.displayName
		? item.ownerProfile
		: null;
}

function initials(value: string | null | undefined) {
	const text = (value ?? "").replace(/\s+/g, " ").trim();
	if (!text) return "·";
	const parts = text.split(" ");
	const letters =
		parts.length >= 2
			? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`
			: text.slice(0, 2);
	return letters.toUpperCase();
}

function armPointerHover() {
	suppressPointerHover = true;
	if (pointerHoverTimer != null) window.clearTimeout(pointerHoverTimer);
	pointerHoverTimer = window.setTimeout(() => {
		suppressPointerHover = false;
		pointerHoverTimer = null;
	}, POINTER_HOVER_ARM_MS);
}

function handleResultPointerMove(index: number) {
	if (suppressPointerHover) return;
	activeIndex = index;
}

function typeMeta(type: CommandPaletteItem["type"]) {
	if (type === "turn") return { className: "turn", icon: MessageSquare };
	if (type === "session") return { className: "session", icon: TerminalSquare };
	if (type === "command") return { className: "command", icon: Plus };
	return { className: "space", icon: FolderKanban };
}

function contextFor(item: CommandPaletteItem) {
	if (item.type === "command") return item.excerpt ?? "Command";
	if (item.type === "space") return item.excerpt ?? "Space";
	if (item.type === "session") return item.spaceName ?? "Session";
	return `${item.spaceName ?? "Space"}${item.sessionTitle ? ` / ${item.sessionTitle}` : ""} · Turn #${item.sequence ?? "?"}`;
}

function openPalette(detail?: OpenCommandPaletteDetail) {
	title = detail?.title ?? "Command search";
	placeholder = detail?.placeholder ?? DEFAULT_PLACEHOLDER;
	query = detail?.query ?? "";
	activeIndex = 0;
	armPointerHover();
	open = true;
	void tick().then(() => inputEl?.focus());
}

function closePalette() {
	open = false;
	query = "";
	title = "Command search";
	placeholder = DEFAULT_PLACEHOLDER;
	activeIndex = 0;
	settledItems = [];
	searchToken += 1;
	localController?.abort();
	remoteController?.abort();
}

function resetSearch() {
	localController?.abort();
	remoteController?.abort();
	if (debounceTimer != null) window.clearTimeout(debounceTimer);
	localItems = [];
	remoteItems = [];
	defaultItems = [];
	localDone = true;
	remoteDone = true;
	defaultDone = true;
	remoteError = null;
	activeIndex = 0;
}

function scheduleSearch(plan: typeof searchPlan, spaceId: string | null) {
	const q = plan.query.trim();
	resetSearch();
	const token = ++searchToken;
	if (q.length < MIN_QUERY_LENGTH) {
		defaultDone = false;
		localController = new AbortController();
		void getCommandPaletteDefaultItems({
			...plan,
			currentSpaceId: spaceId,
			signal: localController.signal,
		})
			.then((items) => {
				if (token !== searchToken) return;
				defaultItems = items;
			})
			.catch((error) => {
				console.warn("[command-palette] default items failed", error);
			})
			.finally(() => {
				if (token === searchToken) defaultDone = true;
			});
		return;
	}

	localDone = false;
	remoteDone = false;
	localController = new AbortController();
	remoteController = new AbortController();

	void searchLocalCommandItems(q, {
		signal: localController.signal,
		resourceTypes: plan.resourceTypes,
	})
		.then((items) => {
			if (token !== searchToken) return;
			localItems = items;
		})
		.catch((error) => {
			if (error?.name !== "AbortError")
				console.warn("[command-palette] local search failed", error);
		})
		.finally(() => {
			if (token === searchToken) localDone = true;
		});

	const remoteResourceTypes = getRemoteResourceTypes(plan);
	if (remoteResourceTypes && remoteResourceTypes.length === 0) {
		remoteDone = true;
		return;
	}

	debounceTimer = window.setTimeout(() => {
		void searchRemoteCommandItems(q, {
			signal: remoteController?.signal,
			limit: RESULT_LIMIT,
			types: remoteResourceTypes,
		})
			.then((items) => {
				if (token !== searchToken) return;
				remoteItems = items;
				remoteError = null;
			})
			.catch((error) => {
				if (token !== searchToken || error?.name === "AbortError") return;
				remoteError =
					error instanceof Error ? error.message : "server unavailable";
			})
			.finally(() => {
				if (token === searchToken) remoteDone = true;
			});
	}, DEBOUNCE_MS);
}

async function activate(item: CommandPaletteItem | undefined) {
	if (!item) return;
	await openCommandItem(item);
	closePalette();
}

function moveActive(delta: number) {
	if (renderedItems.length === 0) {
		activeIndex = 0;
		return;
	}
	activeIndex = Math.min(
		Math.max(activeIndex + delta, 0),
		renderedItems.length - 1,
	);
}

async function scrollActiveIntoView() {
	if (!open) return;
	await tick();
	resultsEl
		?.querySelector<HTMLElement>(".command-result.active")
		?.scrollIntoView({ block: "nearest" });
}

function handlePaletteKeydown(event: KeyboardEvent) {
	if (event.key === "Escape") {
		event.preventDefault();
		closePalette();
		return;
	}
	if (
		event.key === "ArrowDown" ||
		(event.ctrlKey && event.key.toLowerCase() === "n")
	) {
		event.preventDefault();
		moveActive(1);
		return;
	}
	if (
		event.key === "ArrowUp" ||
		(event.ctrlKey && event.key.toLowerCase() === "p")
	) {
		event.preventDefault();
		moveActive(-1);
		return;
	}
	if (event.key === "Enter") {
		event.preventDefault();
		void activate(renderedItems[activeIndex]);
	}
}

function handleGlobalKeydown(event: KeyboardEvent) {
	if (open && event.key === "Escape") {
		event.preventDefault();
		event.stopPropagation();
		closePalette();
		return;
	}

	if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
		event.preventDefault();
		open ? closePalette() : openPalette();
	}
}

function handleOpenPaletteEvent(event: Event) {
	openPalette((event as CustomEvent<OpenCommandPaletteDetail>).detail);
}

$effect(() => {
	if (!open) return;
	scheduleSearch(searchPlan, currentSpaceId);
});

$effect(() => {
	if (mergedItems.length > 0 || !isSearching) settledItems = mergedItems;
});

$effect(() => {
	if (activeIndex >= renderedItems.length)
		activeIndex = Math.max(renderedItems.length - 1, 0);
});

$effect(() => {
	activeIndex;
	renderedItems.length;
	void scrollActiveIntoView();
});

onMount(() => {
	window.addEventListener("keydown", handleGlobalKeydown, { capture: true });
	window.addEventListener("cohub:open-command-palette", handleOpenPaletteEvent);
	return () => {
		window.removeEventListener("keydown", handleGlobalKeydown, {
			capture: true,
		});
		window.removeEventListener(
			"cohub:open-command-palette",
			handleOpenPaletteEvent,
		);
		localController?.abort();
		remoteController?.abort();
		if (debounceTimer != null) window.clearTimeout(debounceTimer);
		if (pointerHoverTimer != null) window.clearTimeout(pointerHoverTimer);
	};
});
</script>

{#if open}
	<div class="command-palette-root" role="presentation" onmousedown={(event) => { if (event.target === event.currentTarget) closePalette(); }}>
		<div class="command-palette" role="dialog" aria-modal="true" aria-label={title} tabindex="-1" onkeydown={handlePaletteKeydown}>
			<div class="command-input-row">
				<Search class="h-4 w-4 text-text-tertiary" />
				<input
					bind:this={inputEl}
					bind:value={query}
					class="command-input"
					{placeholder}
					autocomplete="off"
					spellcheck="false"
				/>
				<div class="command-shortcut">⌘K</div>
			</div>

			<div bind:this={resultsEl} class:searching={showingSettledItems} class="command-results" role="listbox" aria-label="Search results">
				{#if renderedItems.length === 0}
					<div class="command-empty">
						<div class="command-empty-mark"><CornerDownRight class="h-4 w-4" /></div>
						<div>
							<div class="text-[13px] font-medium text-text-secondary">
								{trimmedQuery.length < MIN_QUERY_LENGTH ? "Command lens ready" : "No matching results"}
							</div>
							<div class="mt-1 text-[12px] text-text-tertiary">
								{trimmedQuery.length < MIN_QUERY_LENGTH ? "Try type:space, type:turn, type:session, or new space." : "Try a different phrase or type filter."}
							</div>
						</div>
					</div>
				{:else}
					{#each renderedItems as item, index (`${item.type}:${item.id || item.turnId || item.sessionId || item.spaceId}`)}
						{@const meta = typeMeta(item.type)}
						{@const Icon = meta.icon}
						{@const profile = profileFor(item)}
						<button
							type="button"
							class:active={index === activeIndex}
							class="command-result"
							onpointermove={() => handleResultPointerMove(index)}
							onclick={() => void activate(item)}
							role="option"
							aria-selected={index === activeIndex}
						>
							<div class={`command-type-mark ${meta.className}`} aria-label={item.type}>
								<Icon class="h-3.5 w-3.5" />
							</div>
							<div class="min-w-0 flex-1 text-left">
								<div class="flex min-w-0 items-center gap-2">
									<span class="truncate text-[13px] font-medium text-text-primary">{item.title}</span>
								</div>
								<div class="command-context-row">
									{#if profile}
										<span class="command-profile" title={profile.displayName}>
											<span class="command-profile-avatar" aria-hidden="true">
												{#if profile.avatarUrl}
													<img src={profile.avatarUrl} alt="" loading="lazy" />
												{:else}
													{initials(profile.displayName)}
												{/if}
											</span>
											<span class="truncate">{profile.displayName}</span>
										</span>
										<span class="command-context-separator">·</span>
									{/if}
									<span class="truncate">{contextFor(item)}</span>
								</div>
							</div>
							<div class="command-enter">↵</div>
						</button>
					{/each}
				{/if}
			</div>

			<div class="command-footer">
				<div class="flex items-center gap-2">
					{#if isSearching}<Loader2 class="h-3 w-3 animate-spin text-brand" />{/if}
					<span>{statusText}</span>
				</div>
				<div class="hidden items-center gap-2 sm:flex"><span>↑↓</span><span>C-n/p</span><span>navigate</span><span>↵</span><span>open</span><span>esc</span><span>close</span></div>
			</div>
		</div>
	</div>
{/if}

<style>
	.command-palette-root {
		position: fixed;
		inset: 0;
		z-index: 80;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: clamp(48px, 10vh, 92px) 16px 24px;
		background: color-mix(in oklch, var(--bg-primary) 56%, transparent);
	}

	.command-palette {
		width: min(720px, calc(100vw - 32px));
		max-height: min(640px, calc(100vh - 96px));
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border: 1px solid color-mix(in oklch, var(--border-primary) 72%, var(--brand) 8%);
		border-radius: 14px;
		background: color-mix(in oklch, var(--bg-surface) 94%, var(--brand-900) 6%);
		box-shadow: 0 24px 80px color-mix(in oklch, var(--neutral-100) 74%, transparent), 0 0 0 1px color-mix(in oklch, var(--neutral-0) 4%, transparent) inset;
		animation: command-enter 140ms cubic-bezier(0.16, 1, 0.3, 1);
	}

	.command-input-row {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 14px 16px;
		border-bottom: 1px solid var(--border-subtle);
		background: color-mix(in oklch, var(--bg-primary) 30%, transparent);
	}

	.command-input {
		min-width: 0;
		flex: 1;
		border: 0;
		outline: 0;
		background: transparent;
		color: var(--text-primary);
		font-size: 15px;
		line-height: 1.4;
	}

	.command-input::placeholder { color: var(--text-placeholder); }

	.command-shortcut,
	.command-enter,
	.command-footer {
		font-family: var(--font-mono);
		letter-spacing: 0.02em;
	}

	.command-shortcut {
		border: 1px solid var(--border-subtle);
		border-radius: 6px;
		padding: 2px 6px;
		color: var(--text-tertiary);
		font-size: 11px;
	}

	.command-results {
		overflow-y: auto;
		padding: 8px;
		transition: opacity 120ms cubic-bezier(0.25, 1, 0.5, 1);
	}

	.command-results.searching {
		opacity: 0.72;
	}

	.command-result {
		position: relative;
		display: flex;
		width: 100%;
		align-items: center;
		gap: 12px;
		border: 0;
		border-radius: 9px;
		background: transparent;
		padding: 10px 10px;
		color: inherit;
		transition: background-color 90ms cubic-bezier(0.25, 1, 0.5, 1), transform 90ms cubic-bezier(0.25, 1, 0.5, 1);
	}

	.command-result::before {
		content: "";
		position: absolute;
		left: 0;
		top: 8px;
		bottom: 8px;
		width: 2px;
		border-radius: 999px;
		background: transparent;
	}

	.command-result.active { background: color-mix(in oklch, var(--brand-bg) 56%, var(--bg-hover) 44%); }
	.command-result.active::before { background: var(--brand); }
	.command-result.active .command-enter { opacity: 1; }
	.command-result.active .command-type-mark { border-color: color-mix(in oklch, currentColor 36%, transparent); }

	.command-type-mark {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border: 1px solid color-mix(in oklch, currentColor 18%, transparent);
		border-radius: 7px;
		background: color-mix(in oklch, currentColor 10%, var(--bg-primary) 90%);
		color: var(--text-tertiary);
	}

	.command-type-mark.space {
		color: var(--brand);
		background: color-mix(in oklch, var(--brand) 12%, var(--bg-primary) 88%);
	}

	.command-type-mark.session {
		color: color-mix(in oklch, var(--text-secondary) 82%, var(--brand) 18%);
		background: color-mix(in oklch, var(--text-secondary) 8%, var(--bg-primary) 92%);
	}

	.command-type-mark.turn {
		color: color-mix(in oklch, var(--text-tertiary) 72%, var(--brand) 28%);
		background: color-mix(in oklch, var(--text-tertiary) 7%, var(--bg-primary) 93%);
	}

	.command-type-mark.command {
		color: var(--brand);
		background: color-mix(in oklch, var(--brand) 10%, var(--bg-primary) 90%);
	}

	.command-context-row {
		margin-top: 2px;
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 6px;
		color: var(--text-tertiary);
		font-size: 12px;
		line-height: 1.35;
	}

	.command-profile {
		display: inline-flex;
		min-width: 0;
		max-width: min(190px, 42%);
		flex-shrink: 0;
		align-items: center;
		gap: 5px;
		color: color-mix(in oklch, var(--text-secondary) 86%, var(--brand) 14%);
	}

	.command-profile-avatar {
		display: inline-grid;
		width: 16px;
		height: 16px;
		place-items: center;
		flex: 0 0 auto;
		overflow: hidden;
		border: 1px solid var(--border-subtle);
		border-radius: 999px;
		background: var(--bg-primary);
		color: var(--text-tertiary);
		font-size: 8px;
		font-weight: 650;
		letter-spacing: 0.02em;
		line-height: 1;
	}

	.command-profile-avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.command-context-separator {
		flex: 0 0 auto;
		color: var(--text-placeholder);
	}

	.command-enter {
		opacity: 0;
		color: var(--brand);
		font-size: 13px;
	}

	.command-empty {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 34px 22px;
	}

	.command-empty-mark {
		display: grid;
		place-items: center;
		width: 34px;
		height: 34px;
		border-radius: 9px;
		background: var(--bg-primary);
		color: var(--text-tertiary);
	}

	.command-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		border-top: 1px solid var(--border-subtle);
		padding: 8px 12px;
		color: var(--text-placeholder);
		font-size: 10px;
	}

	@keyframes command-enter {
		from { opacity: 0; transform: translateY(-8px) scale(0.985); }
		to { opacity: 1; transform: translateY(0) scale(1); }
	}

	@media (prefers-reduced-motion: reduce) {
		.command-palette,
		.command-results,
		.command-result {
			animation: none;
			transition: none;
		}
	}
</style>
