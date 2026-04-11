<script lang="ts">
import { fade, scale } from "svelte/transition";
import { X, Image } from "lucide-svelte";

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

const { open, onClose, onSelect, models, currentModel = null }: Props = $props();

let searchQuery = $state("");
let selectedIndex = $state(0);
let navigationMode: "mouse" | "keyboard" = $state("mouse");
let containerEl = $state<HTMLElement | null>(null);
let searchInputEl = $state<HTMLInputElement | null>(null);

function getDisplayName(item: ModelItem): string {
	const name = item.model.name;
	return (typeof name === "string" && name.trim()) ? name : item.id;
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
				const text = `${item.provider} ${item.id} ${getDisplayName(item)}`.toLowerCase();
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
			const aIsCurrent = a.provider === currentModel.provider && a.id === currentModel.id;
			const bIsCurrent = b.provider === currentModel.provider && b.id === currentModel.id;
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
		// Focus search input after render
		requestAnimationFrame(() => {
			searchInputEl?.focus();
		});
	}
});

function handleKeyDown(e: KeyboardEvent) {
	if (!open) return;
	if (e.key === "Escape") {
		e.preventDefault();
		onClose();
		return;
	}
	if (e.key === "ArrowDown") {
		e.preventDefault();
		navigationMode = "keyboard";
		selectedIndex = Math.min(selectedIndex + 1, filteredModels.length - 1);
		scrollSelectedIntoView();
		return;
	}
	if (e.key === "ArrowUp") {
		e.preventDefault();
		navigationMode = "keyboard";
		selectedIndex = Math.max(selectedIndex - 1, 0);
		scrollSelectedIntoView();
		return;
	}
	if (e.key === "Enter" && filteredModels[selectedIndex]) {
		e.preventDefault();
		const selected = filteredModels[selectedIndex];
		onSelect({ provider: selected.provider, id: selected.id });
		return;
	}
}

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

<svelte:window onkeydown={handleKeyDown} />

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-4"
		in:fade={{ duration: 150 }}
		out:fade={{ duration: 150 }}
		role="dialog"
		aria-modal="true"
		aria-label="Select model"
	>
		<!-- Backdrop -->
		<div
			class="absolute inset-0 bg-black/40"
			onclick={onClose}
			aria-hidden="true"
		></div>

		<!-- Modal -->
		<div
			class="relative w-full max-w-[420px] rounded-xl border border-border-subtle bg-bg-primary shadow-2xl overflow-hidden flex flex-col max-h-[70vh]"
			transition:scale={{ duration: 200, start: 0.95 }}
		>
			<!-- Header -->
			<div class="h-9 flex items-center justify-between px-3 border-b border-border-subtle text-[10px] font-medium uppercase tracking-wider text-text-tertiary select-none shrink-0">
				<span>Select Model</span>
				<button
					type="button"
					class="flex items-center justify-center w-6 h-6 rounded-[4px] text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors"
					onclick={onClose}
					title="Close"
				>
					<X class="w-3.5 h-3.5" />
				</button>
			</div>

			<!-- Search -->
			<div class="px-3 pt-3 pb-2 border-b border-border-subtle">
				<input
					bind:this={searchInputEl}
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
						<div
							class={`px-4 py-2 cursor-pointer border-b border-border-subtle/50 transition-colors ${
								navigationMode === "mouse" ? "hover:bg-bg-hover" : ""
							} ${index === selectedIndex ? "bg-accent" : ""}`}
							data-model-item
							onclick={() => onSelect({ provider: item.provider, id: item.id })}
							onmouseenter={() => {
								if (navigationMode === "mouse") {
									selectedIndex = index;
								}
							}}
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
										<span class="text-emerald-500 shrink-0 text-[12px]">✓</span>
									{/if}
								</div>
								<span class="text-[11px] text-text-tertiary opacity-60 shrink-0">
									{item.provider}
								</span>
							</div>
						</div>
					{/each}
				{/if}
			</div>
		</div>
	</div>
{/if}
