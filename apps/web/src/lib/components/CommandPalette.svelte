<script lang="ts">
import {
	CornerDownRight,
	FolderKanban,
	Loader2,
	MessageSquare,
	Search,
	TerminalSquare,
} from "lucide-svelte";
import { onMount, tick } from "svelte";
import { searchLocalCommandItems } from "$lib/command-palette/local-search";
import { mergeCommandResults } from "$lib/command-palette/merge-results";
import {
	getRecentCommandItems,
	openCommandItem,
} from "$lib/command-palette/recent";
import { searchRemoteCommandItems } from "$lib/command-palette/remote-search";
import type { CommandPaletteItem } from "$lib/command-palette/types";

const MIN_QUERY_LENGTH = 2;
const RESULT_LIMIT = 30;
const DEBOUNCE_MS = 180;

let open = $state(false);
let query = $state("");
let inputEl = $state<HTMLInputElement | null>(null);
let resultsEl = $state<HTMLDivElement | null>(null);
let activeIndex = $state(0);
let localItems = $state<CommandPaletteItem[]>([]);
let remoteItems = $state<import("@neta-art/cohub").GlobalSearchResult[]>([]);
let localDone = $state(true);
let remoteDone = $state(true);
let remoteError = $state<string | null>(null);
let debounceTimer: number | null = null;
let localController: AbortController | null = null;
let remoteController: AbortController | null = null;
let searchToken = 0;

const trimmedQuery = $derived(query.trim());
const recentItems = $derived(getRecentCommandItems());
const mergedItems = $derived(
	trimmedQuery.length < MIN_QUERY_LENGTH
		? recentItems
		: mergeCommandResults({
				local: localItems,
				remote: remoteItems,
				limit: RESULT_LIMIT,
			}),
);
const isSearching = $derived(!localDone || !remoteDone);
const statusText = $derived.by(() => {
	if (trimmedQuery.length < MIN_QUERY_LENGTH) {
		return recentItems.length > 0
			? "Recent targets · type 2+ characters to search"
			: "Search spaces, sessions, and user messages";
	}
	if (remoteError) return `Local results only · ${remoteError}`;
	if (!remoteDone) return `Local ${localItems.length} · syncing server…`;
	if (!localDone) return "Searching indexed cache…";
	return `${mergedItems.length} result${mergedItems.length === 1 ? "" : "s"} · indexed cache + server`;
});

function typeMeta(type: CommandPaletteItem["type"]) {
	if (type === "turn") return { className: "message", icon: MessageSquare };
	if (type === "session") return { className: "session", icon: TerminalSquare };
	return { className: "space", icon: FolderKanban };
}

function contextFor(item: CommandPaletteItem) {
	if (item.type === "space") return item.excerpt ?? "Space";
	if (item.type === "session") return item.spaceName ?? "Session";
	return `${item.spaceName ?? "Space"}${item.sessionTitle ? ` / ${item.sessionTitle}` : ""} · Turn #${item.sequence ?? "?"}`;
}

function openPalette() {
	open = true;
	void tick().then(() => inputEl?.focus());
}

function closePalette() {
	open = false;
	query = "";
	activeIndex = 0;
	localController?.abort();
	remoteController?.abort();
}

function resetSearch() {
	localController?.abort();
	remoteController?.abort();
	if (debounceTimer != null) window.clearTimeout(debounceTimer);
	localItems = [];
	remoteItems = [];
	localDone = true;
	remoteDone = true;
	remoteError = null;
	activeIndex = 0;
}

function scheduleSearch(value: string) {
	const q = value.trim();
	resetSearch();
	if (q.length < MIN_QUERY_LENGTH) return;
	localDone = false;
	remoteDone = false;
	const token = ++searchToken;
	localController = new AbortController();
	remoteController = new AbortController();

	void searchLocalCommandItems(q, { signal: localController.signal })
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

	debounceTimer = window.setTimeout(() => {
		void searchRemoteCommandItems(q, {
			signal: remoteController?.signal,
			limit: RESULT_LIMIT,
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
	if (mergedItems.length === 0) {
		activeIndex = 0;
		return;
	}
	activeIndex = Math.min(
		Math.max(activeIndex + delta, 0),
		mergedItems.length - 1,
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
		void activate(mergedItems[activeIndex]);
	}
}

function handleGlobalKeydown(event: KeyboardEvent) {
	if (open && event.key === "Escape") {
		event.preventDefault();
		closePalette();
		return;
	}

	if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
		event.preventDefault();
		open ? closePalette() : openPalette();
	}
}

function handleOpenPaletteEvent() {
	openPalette();
}

$effect(() => {
	const q = query;
	scheduleSearch(q);
});

$effect(() => {
	if (activeIndex >= mergedItems.length)
		activeIndex = Math.max(mergedItems.length - 1, 0);
});

$effect(() => {
	activeIndex;
	mergedItems.length;
	void scrollActiveIntoView();
});

onMount(() => {
	window.addEventListener("keydown", handleGlobalKeydown);
	window.addEventListener("cohub:open-command-palette", handleOpenPaletteEvent);
	return () => {
		window.removeEventListener("keydown", handleGlobalKeydown);
		window.removeEventListener(
			"cohub:open-command-palette",
			handleOpenPaletteEvent,
		);
		localController?.abort();
		remoteController?.abort();
		if (debounceTimer != null) window.clearTimeout(debounceTimer);
	};
});
</script>

{#if open}
	<div class="command-palette-root" role="presentation" onmousedown={(event) => { if (event.target === event.currentTarget) closePalette(); }}>
		<div class="command-palette" role="dialog" aria-modal="true" aria-label="Command search" tabindex="-1" onkeydown={handlePaletteKeydown}>
			<div class="command-input-row">
				<Search class="h-4 w-4 text-text-tertiary" />
				<input
					bind:this={inputEl}
					bind:value={query}
					class="command-input"
					placeholder="Search messages, sessions, spaces…"
					autocomplete="off"
					spellcheck="false"
				/>
				<div class="command-shortcut">⌘K</div>
			</div>

			<div bind:this={resultsEl} class="command-results" role="listbox" aria-label="Search results">
				{#if mergedItems.length === 0}
					<div class="command-empty">
						<div class="command-empty-mark"><CornerDownRight class="h-4 w-4" /></div>
						<div>
							<div class="text-[13px] font-medium text-text-secondary">
								{trimmedQuery.length < MIN_QUERY_LENGTH ? "Command lens ready" : "No matching command history"}
							</div>
							<div class="mt-1 text-[12px] text-text-tertiary">
								{trimmedQuery.length < MIN_QUERY_LENGTH ? "Type a space name, session title, or user message." : "Try a different phrase from a user message or session title."}
							</div>
						</div>
					</div>
				{:else}
					{#each mergedItems as item, index (`${item.type}:${item.turnId ?? item.sessionId ?? item.spaceId}`)}
						{@const meta = typeMeta(item.type)}
						{@const Icon = meta.icon}
						<button
							type="button"
							class:active={index === activeIndex}
							class="command-result"
							onmouseenter={() => { activeIndex = index; }}
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
								<div class="mt-0.5 truncate text-[12px] text-text-tertiary">{contextFor(item)}</div>
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
		border: 1px solid color-mix(in oklch, var(--border-primary) 72%, var(--brand-400) 8%);
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
		transition: background-color 90ms ease, transform 90ms ease;
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

	.command-result.active {
		background: color-mix(in oklch, var(--brand-bg) 56%, var(--bg-hover) 44%);
	}

	.command-result.active::before { background: var(--brand-400); }
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
		color: var(--brand-400);
		background: color-mix(in oklch, var(--brand-400) 12%, var(--bg-primary) 88%);
	}

	.command-type-mark.session {
		color: color-mix(in oklch, var(--text-secondary) 82%, var(--brand-400) 18%);
		background: color-mix(in oklch, var(--text-secondary) 8%, var(--bg-primary) 92%);
	}

	.command-type-mark.message {
		color: color-mix(in oklch, var(--text-tertiary) 72%, var(--brand-400) 28%);
		background: color-mix(in oklch, var(--text-tertiary) 7%, var(--bg-primary) 93%);
	}

	.command-enter {
		opacity: 0;
		color: var(--brand-400);
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
</style>
