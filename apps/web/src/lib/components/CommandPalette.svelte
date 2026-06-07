<script lang="ts">
import type { ContentBlock } from "@cohub/protocol/core";
import {
	CornerDownRight,
	FolderKanban,
	Loader2,
	MessageSquare,
	Plus,
	Search,
	Tag,
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
import SpaceAvatar from "$lib/components/SpaceAvatar.svelte";
import ToolCallList from "$lib/components/ToolCallList.svelte";
import { isComposingKeyboardEvent } from "$lib/keyboard";
import { sdk } from "$lib/sdk";
import {
	fetchSpaceListWithCache,
	getCachedSpaceListMeta,
} from "$lib/stores/space-list-cache";

const MIN_QUERY_LENGTH = 2;
const RESULT_LIMIT = 30;
const DEBOUNCE_MS = 180;
const POINTER_HOVER_ARM_MS = 220;
const DEFAULT_PLACEHOLDER =
	"Search turns, sessions, spaces, labels… Try label:bug";

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
let spaceListRefreshToken = 0;
let runMode = $state(false);
let runCommand = $state("");
let runTaskId = $state<string | null>(null);
let runProgress = $state<ContentBlock[] | null>(null);
let runResult = $state<ContentBlock[] | null>(null);
let runStatus = $state<"idle" | "queued" | "running" | "done" | "failed">(
	"idle",
);
let runError = $state("");
let runPollTimer: number | null = null;

const currentSpaceId = $derived.by(() => {
	const match = page.url.pathname.match(/^\/spaces\/([^/]+)/);
	const id = match?.[1] ?? null;
	return id === "new" ? null : id;
});
const parsedQuery = $derived(parseCommandPaletteQuery(query));
const searchPlan = $derived({
	query: parsedQuery.query,
	resourceTypes: parsedQuery.resourceTypes,
	labelRef: parsedQuery.labelRef,
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
const runBlocks = $derived(runResult ?? runProgress ?? []);
const statusText = $derived.by(() => {
	const label = typeLabel ?? "Turns, Sessions, Spaces, Labels, and Commands";
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

function handleCommandInput(event: Event) {
	const value = (event.currentTarget as HTMLInputElement).value;
	if (runMode) {
		runCommand = value;
		if (runStatus !== "running" && runStatus !== "queued") {
			runTaskId = null;
			runProgress = null;
			runResult = null;
			runError = "";
			runStatus = "idle";
		}
		return;
	}
	query = value;
}

function typeMeta(type: CommandPaletteItem["type"]) {
	if (type === "turn") return { className: "turn", icon: MessageSquare };
	if (type === "session") return { className: "session", icon: TerminalSquare };
	if (type === "label") return { className: "label", icon: Tag };
	if (type === "command") return { className: "command", icon: Plus };
	return { className: "space", icon: FolderKanban };
}

function contextFor(item: CommandPaletteItem) {
	if (item.type === "command") return item.excerpt ?? "Command";
	if (item.type === "space") return item.excerpt ?? "Space";
	if (item.type === "label")
		return `Label: ${item.labelRef ?? item.labelName ?? "Label"}${item.spaceName ? ` · ${item.spaceName}` : ""}`;
	if (item.type === "session") return item.spaceName ?? "Session";
	return `${item.spaceName ?? "Space"}${item.sessionTitle ? ` / ${item.sessionTitle}` : ""} · Turn #${item.sequence ?? "?"}`;
}

function itemTimestamp(item: CommandPaletteItem) {
	if (!item.updatedAt) return null;
	const date = new Date(item.updatedAt);
	const time = date.getTime();
	if (!Number.isFinite(time)) return null;

	const now = new Date();
	const isSameLocalDay =
		date.getFullYear() === now.getFullYear() &&
		date.getMonth() === now.getMonth() &&
		date.getDate() === now.getDate();
	const pad = (value: number) => String(value).padStart(2, "0");
	const dateLabel = `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
	const timeLabel = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
	const timezoneLabel = new Intl.DateTimeFormat(undefined, {
		timeZoneName: "short",
	})
		.formatToParts(date)
		.find((part) => part.type === "timeZoneName")?.value;

	return {
		label: isSameLocalDay ? timeLabel : dateLabel,
		title: `${dateLabel} ${timeLabel}${timezoneLabel ? ` ${timezoneLabel}` : ""}`,
	};
}

function resetRunState() {
	runMode = false;
	runCommand = "";
	runTaskId = null;
	runProgress = null;
	runResult = null;
	runStatus = "idle";
	runError = "";
	if (runPollTimer != null) window.clearInterval(runPollTimer);
	runPollTimer = null;
}

function openPalette(detail?: OpenCommandPaletteDetail) {
	title = detail?.title ?? "Command search";
	placeholder = detail?.placeholder ?? DEFAULT_PLACEHOLDER;
	query = detail?.query ?? "";
	activeIndex = 0;
	armPointerHover();
	resetRunState();
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
	resetRunState();
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

async function refreshSpaceListForDefaultItems(token: number) {
	const cacheMeta = getCachedSpaceListMeta();
	if (cacheMeta && !cacheMeta.isStale) return;

	try {
		await fetchSpaceListWithCache(async () => await sdk.spaces.list());
	} catch (error) {
		console.warn("[command-palette] space list refresh failed", error);
		return;
	}

	if (token !== searchToken || !open || runMode) return;
	if (trimmedQuery.length >= MIN_QUERY_LENGTH) return;
	spaceListRefreshToken += 1;
}

function scheduleSearch(plan: typeof searchPlan, spaceId: string | null) {
	const q = plan.query.trim();
	const hasLabelScope = Boolean(
		plan.labelRef && plan.resourceTypes?.includes("label"),
	);
	resetSearch();
	const token = ++searchToken;
	if (q.length < MIN_QUERY_LENGTH && !hasLabelScope) {
		defaultDone = false;
		localController = new AbortController();
		void refreshSpaceListForDefaultItems(token);
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
		labelRef: plan.labelRef,
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
			labelRef: plan.labelRef,
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

function openRunCommandMode() {
	runMode = true;
	title = "Run Command";
	placeholder = "Type a command…";
	runCommand = "";
	runTaskId = null;
	runProgress = null;
	runResult = null;
	runStatus = "idle";
	runError = "";
	activeIndex = 0;
	void tick().then(() => inputEl?.focus());
}

async function submitRunCommand() {
	if (!currentSpaceId) {
		runError = "Open a space first.";
		runStatus = "failed";
		return;
	}
	if (!runCommand.trim() || runStatus === "running" || runStatus === "queued")
		return;
	runError = "";
	runStatus = "queued";
	try {
		const { taskRunId } = await sdk.space(currentSpaceId).runCommand({
			command: runCommand.trim(),
		});
		runTaskId = taskRunId;
		runProgress = null;
		runResult = null;
		runStatus = "running";
		if (runPollTimer != null) window.clearInterval(runPollTimer);
		const poll = async () => {
			if (!runTaskId) return;
			try {
				const { run, progress } = await sdk.tasks.get(runTaskId);
				runProgress =
					(progress as { content?: ContentBlock[] } | null)?.content ?? null;
				if (run.status === "completed") {
					runStatus = "done";
					runResult =
						(run.result as { content?: ContentBlock[] } | null)?.content ??
						null;
					if (runPollTimer != null) window.clearInterval(runPollTimer);
					runPollTimer = null;
					return;
				}
				if (run.status === "failed") {
					runStatus = "failed";
					runError = run.errorMessage ?? "Command failed";
					if (runPollTimer != null) window.clearInterval(runPollTimer);
					runPollTimer = null;
				}
			} catch (error) {
				console.warn("[command-palette] command polling failed", error);
			}
		};
		await poll();
		runPollTimer = window.setInterval(() => void poll(), 1000);
	} catch (error) {
		runStatus = "failed";
		runError = error instanceof Error ? error.message : "Failed to run command";
	}
}

async function activate(item: CommandPaletteItem | undefined) {
	if (!item) return;
	if (item.id === "run-command") {
		openRunCommandMode();
		return;
	}
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
		if (runMode) {
			if (runStatus === "running" || runStatus === "queued") {
				closePalette();
				return;
			}
			if (runCommand.trim()) {
				runMode = false;
				title = "Command search";
				placeholder = DEFAULT_PLACEHOLDER;
				runStatus = "idle";
				return;
			}
		}
		closePalette();
		return;
	}
	if (isComposingKeyboardEvent(event)) return;
	if (runMode) {
		if (event.key === "Enter") {
			event.preventDefault();
			void submitRunCommand();
		}
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
	if (isComposingKeyboardEvent(event)) return;
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
	if (!open || runMode) return;
	spaceListRefreshToken;
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
				{#if runMode}
					<TerminalSquare class="h-4 w-4 text-brand" />
				{:else}
					<Search class="h-4 w-4 text-text-tertiary" />
				{/if}
				<input
					bind:this={inputEl}
					value={runMode ? runCommand : query}
					class="command-input"
					placeholder={placeholder}
					autocomplete="off"
					spellcheck="false"
					oninput={handleCommandInput}
				/>
				{#if runMode}
					<div class="command-shortcut">↵ Run</div>
				{:else}
					<div class="command-shortcut">⌘K</div>
				{/if}
			</div>

			{#if runMode}
				<div bind:this={resultsEl} class="command-results command-runner">
					{#if runError}
						<div class="command-empty">
							<div class="command-empty-mark"><CornerDownRight class="h-4 w-4" /></div>
							<div>
								<div class="text-[13px] font-medium text-text-secondary">{runStatus === "failed" ? "Command failed" : "Run command ready"}</div>
								<div class="mt-1 text-[12px] text-text-tertiary">{runError}</div>
							</div>
						</div>
					{:else if !currentSpaceId}
						<div class="command-empty">
							<div class="command-empty-mark"><CornerDownRight class="h-4 w-4" /></div>
							<div>
								<div class="text-[13px] font-medium text-text-secondary">Open a space first</div>
								<div class="mt-1 text-[12px] text-text-tertiary">Run commands need a space context.</div>
							</div>
						</div>
					{:else if runBlocks.length === 0}
						<div class="command-empty">
							<div class="command-empty-mark"><CornerDownRight class="h-4 w-4" /></div>
							<div>
								<div class="text-[13px] font-medium text-text-secondary">Ready to run</div>
								<div class="mt-1 text-[12px] text-text-tertiary">Enter a bash command and press ↵.</div>
							</div>
						</div>
					{:else}
						<ToolCallList content={runBlocks} streaming={runStatus === "running" || runStatus === "queued"} defaultExpanded flush />
					{/if}
				</div>
			{:else}
				<div bind:this={resultsEl} class:searching={showingSettledItems} class="command-results" role="listbox" aria-label="Search results">
					{#if renderedItems.length === 0}
						<div class="command-empty">
							<div class="command-empty-mark"><CornerDownRight class="h-4 w-4" /></div>
							<div>
								<div class="text-[13px] font-medium text-text-secondary">
									{trimmedQuery.length < MIN_QUERY_LENGTH ? "Command lens ready" : "No matching results"}
								</div>
								<div class="mt-1 text-[12px] text-text-tertiary">
									{trimmedQuery.length < MIN_QUERY_LENGTH ? "Try label:bug for labels, a: for spaces, or t: for turns." : "Try a different phrase or type filter."}
								</div>
							</div>
						</div>
					{:else}
						{#each renderedItems as item, index (`${item.type}:${item.id || item.turnId || item.sessionId || item.spaceId}`)}
							{@const meta = typeMeta(item.type)}
							{@const Icon = meta.icon}
							{@const profile = profileFor(item)}
							{@const timestamp = itemTimestamp(item)}
							<button
								type="button"
								class:active={index === activeIndex}
								class="command-result"
								onpointermove={() => handleResultPointerMove(index)}
								onclick={() => void activate(item)}
								role="option"
								aria-selected={index === activeIndex}
							>
								{#if item.type === "space"}
									<SpaceAvatar name={item.title || item.spaceName || item.spaceId} profile={item.spaceProfile} size="sm" />
								{:else}
									<div class={`command-type-mark ${meta.className}`} aria-label={item.type}>
										<Icon class="h-3.5 w-3.5" />
									</div>
								{/if}
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
										<span class="command-context" title={contextFor(item)}>{contextFor(item)}</span>
										{#if timestamp}
											<span class="command-context-separator">·</span>
											<time class="command-time" datetime={item.updatedAt ?? undefined} title={timestamp.title}>{timestamp.label}</time>
										{/if}
									</div>
								</div>
								<div class="command-enter">↵</div>
							</button>
						{/each}
					{/if}
				</div>
			{/if}

			<div class="command-footer">
				<div class:error={Boolean(runError)} class="command-status" role="status" aria-live="polite">
					{#if runMode}
						{#if runStatus === "queued" || runStatus === "running"}<Loader2 class="h-3 w-3 animate-spin text-brand" />{/if}
						<span>{runError || (runStatus === "done" ? `Done · ${runTaskId}` : runStatus === "running" ? "Running…" : runStatus === "queued" ? "Queued…" : currentSpaceId ? "Press ↵ to run" : "Open a space first")}</span>
					{:else}
						{#if isSearching}<Loader2 class="h-3 w-3 animate-spin text-brand" />{/if}
						<span>{statusText}</span>
					{/if}
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
	.command-result.active .command-enter {
		opacity: 1;
	}
	.command-result.active .command-time { color: var(--text-secondary); }
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

	.command-type-mark.label {
		color: color-mix(in oklch, var(--brand) 76%, var(--text-secondary) 24%);
		background: color-mix(in oklch, var(--brand) 9%, var(--bg-primary) 91%);
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

	.command-context {
		min-width: 0;
		flex: 0 1 auto;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.command-context-separator {
		flex: 0 0 auto;
		color: var(--text-placeholder);
	}

	.command-time {
		flex: 0 0 auto;
		color: var(--text-placeholder);
		font-family: var(--font-mono);
		font-size: 10px;
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.01em;
		line-height: 1;
		white-space: nowrap;
	}

	.command-enter {
		width: 12px;
		flex: 0 0 auto;
		opacity: 0;
		color: var(--brand);
		font-size: 13px;
		line-height: 1;
		text-align: right;
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

	.command-status {
		display: inline-flex;
		min-width: 0;
		align-items: center;
		gap: 6px;
	}

	.command-status span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.command-status.error {
		color: var(--error-700);
	}

	@keyframes command-enter {
		from { opacity: 0; transform: translateY(-8px) scale(0.985); }
		to { opacity: 1; transform: translateY(0) scale(1); }
	}

	@media (max-width: 640px) {
		.command-palette-root {
			align-items: flex-end;
			padding: 0;
			background: var(--overlay-scrim);
		}

		.command-palette {
			width: 100vw;
			max-height: min(82svh, 680px);
			border-right: 0;
			border-bottom: 0;
			border-left: 0;
			border-radius: 16px 16px 0 0;
			animation-name: command-sheet-enter;
		}

		.command-palette::before {
			content: "";
			align-self: center;
			width: 36px;
			height: 4px;
			margin-top: 8px;
			border-radius: 999px;
			background: var(--border-primary);
		}

		.command-input-row {
			padding: 12px 14px 13px;
		}

		.command-shortcut,
		.command-enter {
			display: none;
		}

		.command-result {
			min-height: 58px;
			gap: 10px;
			padding: 10px 8px;
		}

		.command-type-mark {
			width: 32px;
			height: 32px;
		}

		.command-pin-action,
		.command-pin-action:not(.pinned) {
			min-width: 44px;
			height: 44px;
			opacity: 1;
		}

		.command-footer {
			padding: 10px 14px calc(10px + env(safe-area-inset-bottom));
		}
	}

	@keyframes command-sheet-enter {
		from { opacity: 0; transform: translateY(14px); }
		to { opacity: 1; transform: translateY(0); }
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
