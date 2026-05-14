<script lang="ts">
import { Image } from "lucide-svelte";
import { onMount } from "svelte";
import Dialog from "$lib/components/Dialog.svelte";

type ModelItem = {
	provider: string;
	id: string;
	model: Record<string, unknown>;
};

type Props = {
	open: boolean;
	onClose: () => void;
	onSelect: (item: { provider: string; id: string }) => void;
	models: ModelItem[];
	currentModel?: { provider: string; id: string } | null;
};

const {
	open,
	onClose,
	onSelect,
	models,
	currentModel = null,
}: Props = $props();

let searchQuery = $state("");
let selectedIndex = $state(0);
let navigationMode: "mouse" | "keyboard" = $state("mouse");
let containerEl = $state<HTMLElement | null>(null);
let searchInputEl = $state<HTMLInputElement | null>(null);

function getVisibleSearchInput() {
	if (searchInputEl && searchInputEl.getClientRects().length > 0) {
		return searchInputEl;
	}
	return (
		Array.from(
			document.querySelectorAll<HTMLInputElement>(
				'[data-model-selector-search="true"]',
			),
		).find((input) => input.getClientRects().length > 0) ?? null
	);
}

function focusSearchInputSoon() {
	requestAnimationFrame(() => {
		getVisibleSearchInput()?.focus();
	});
}

function getDisplayName(item: ModelItem): string {
	const name = item.model.name;
	return typeof name === "string" && name.trim() ? name : item.id;
}

function hasVision(item: ModelItem): boolean {
	const input = item.model.input as string[] | undefined;
	return input?.includes("image") ?? false;
}

const filteredModels = $derived.by(() => {
	let result = models;

	if (searchQuery.trim()) {
		const query = searchQuery.toLowerCase().replace(/\s+/g, "");
		const scored = result
			.map((item) => {
				const text =
					`${item.provider} ${item.id} ${getDisplayName(item)}`.toLowerCase();
				const score = subsequenceScore(query, text);
				return score > 0 ? { item, score } : null;
			})
			.filter((s): s is { item: ModelItem; score: number } => s !== null);
		scored.sort((a, b) => b.score - a.score);
		result = scored.map((s) => s.item);
	}

	// When not searching, current model first
	if (!searchQuery.trim() && currentModel) {
		result = [...result].sort((a, b) => {
			const aIsCurrent =
				a.provider === currentModel.provider && a.id === currentModel.id;
			const bIsCurrent =
				b.provider === currentModel.provider && b.id === currentModel.id;
			if (aIsCurrent && !bIsCurrent) return -1;
			if (!aIsCurrent && bIsCurrent) return 1;
			return a.provider.localeCompare(b.provider);
		});
	}

	return result;
});

$effect(() => {
	if (open) {
		searchQuery = "";
		selectedIndex = 0;
		navigationMode = "mouse";
		// Focus search input after render — skip on mobile to avoid keyboard popup
		const isMobile =
			typeof window !== "undefined" &&
			("ontouchstart" in window ||
				window.matchMedia("(pointer: coarse)").matches ||
				navigator.maxTouchPoints > 0);
		if (!isMobile) {
			focusSearchInputSoon();
		}
	}
});

function moveSelection(delta: number) {
	if (filteredModels.length === 0) {
		selectedIndex = 0;
		return;
	}
	navigationMode = "keyboard";
	selectedIndex = Math.min(
		Math.max(selectedIndex + delta, 0),
		filteredModels.length - 1,
	);
	scrollSelectedIntoView();
}

function handleKeyDown(e: KeyboardEvent) {
	if (!open || e.defaultPrevented || e.isComposing) return;
	const key = e.key.toLowerCase();
	if (e.key === "Escape") {
		e.preventDefault();
		e.stopPropagation();
		onClose();
		return;
	}
	if (e.key === "ArrowDown" || (e.ctrlKey && key === "n")) {
		e.preventDefault();
		e.stopPropagation();
		moveSelection(1);
		return;
	}
	if (e.key === "ArrowUp" || (e.ctrlKey && key === "p")) {
		e.preventDefault();
		e.stopPropagation();
		moveSelection(-1);
		return;
	}
	if (e.key === "Enter" && filteredModels[selectedIndex]) {
		e.preventDefault();
		e.stopPropagation();
		const selected = filteredModels[selectedIndex];
		onSelect({ provider: selected.provider, id: selected.id });
		return;
	}
}

onMount(() => {
	window.addEventListener("keydown", handleKeyDown, { capture: true });
	return () => {
		window.removeEventListener("keydown", handleKeyDown, { capture: true });
	};
});

function scrollSelectedIntoView() {
	requestAnimationFrame(() => {
		const selected = containerEl?.querySelector(
			`[data-model-item]:nth-child(${selectedIndex + 1})`,
		) as HTMLElement;
		selected?.scrollIntoView({ block: "nearest" });
	});
}

function isCurrentModel(item: ModelItem): boolean {
	return (
		currentModel !== null &&
		item.provider === currentModel.provider &&
		item.id === currentModel.id
	);
}

function subsequenceScore(query: string, text: string): number {
	let qi = 0;
	let ti = 0;
	let gaps = 0;
	let lastMatchIndex = -1;

	while (qi < query.length && ti < text.length) {
		if (query[qi] === text[ti]) {
			if (lastMatchIndex >= 0) {
				gaps += ti - lastMatchIndex - 1;
			}
			lastMatchIndex = ti;
			qi++;
		}
		ti++;
	}

	if (qi < query.length) return 0;
	return query.length / (query.length + gaps);
}
</script>

<Dialog {open} {onClose} title="Select Model" maxWidth="420px">
	<!-- Search -->
	<div class="px-3 pt-3 pb-2 border-b border-border-subtle">
		<input
			bind:this={searchInputEl}
			data-model-selector-search="true"
			type="text"
			placeholder="Search models..."
			bind:value={searchQuery}
			class="w-full bg-bg-input border border-border-subtle rounded-md px-3 py-2 text-[13px] text-text-primary outline-none placeholder:text-text-placeholder focus:border-brand/40"
		/>
	</div>

	<!-- Model List -->
	<div
		bind:this={containerEl}
		class="flex-1 overflow-y-auto"
	>
		{#if filteredModels.length === 0}
			<div class="px-4 py-6 text-center text-[13px] text-text-tertiary">
				{searchQuery ? "No matching models" : "No models available"}
			</div>
		{:else}
			{#each filteredModels as item, index (item.provider + "/" + item.id)}
				<button
					type="button"
					class={`w-full text-left px-4 py-2 cursor-pointer border-b border-border-subtle/50 transition-colors ${
						navigationMode === "mouse" ? "hover:bg-bg-hover" : ""
					} ${index === selectedIndex ? "bg-accent" : ""}`}
					data-model-item
					onclick={() => onSelect({ provider: item.provider, id: item.id })}
					onmouseenter={() => {
						if (navigationMode === "mouse") {
							selectedIndex = index;
						}
					}}
					aria-pressed={isCurrentModel(item)}
				>
					<div class="flex items-center justify-between gap-2">
						<div class="flex items-center gap-1.5 min-w-0">
							<span class="text-[13px] font-medium text-text-primary truncate">
								{getDisplayName(item)}
							</span>
							{#if hasVision(item)}
								<Image class="w-3.5 h-3.5 text-text-tertiary shrink-0" />
							{/if}
							{#if isCurrentModel(item)}
								<span class="text-status-running shrink-0 text-[12px]">✓</span>
							{/if}
						</div>
						<span class="text-[11px] text-text-tertiary opacity-60 shrink-0">
							{item.provider}
						</span>
					</div>
				</button>
			{/each}
		{/if}
	</div>
</Dialog>
