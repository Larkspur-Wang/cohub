<script lang="ts">
import type { PublicGenerationDeclaration } from "@cohub/protocol/generation";
import { ChevronDown, Image } from "lucide-svelte";
import Dialog from "$lib/components/Dialog.svelte";
import { isComposingKeyboardEvent } from "$lib/keyboard";

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
	generationModels?: PublicGenerationDeclaration[];
	generationPolicyMode?: "auto" | "limited";
	selectedGenerationModels?: Set<string>;
	generationEnumSelections?: Record<string, Record<string, Set<string>>>;
	onGenerationPolicyModeChange?: (mode: "auto" | "limited") => void;
	onGenerationModelToggle?: (model: string, selected: boolean) => void;
	onGenerationEnumValueToggle?: (
		model: string,
		parameter: string,
		value: string,
		selected: boolean,
	) => void;
	onGenerationTabOpen?: () => void;
};

const {
	open,
	onClose,
	onSelect,
	models,
	currentModel = null,
	generationModels = [],
	generationPolicyMode = "auto",
	selectedGenerationModels = new Set<string>(),
	generationEnumSelections = {},
	onGenerationPolicyModeChange,
	onGenerationModelToggle,
	onGenerationEnumValueToggle,
	onGenerationTabOpen,
}: Props = $props();

let searchQuery = $state("");
let selectedIndex = $state(0);
let navigationMode: "mouse" | "keyboard" = $state("mouse");
let activeTab: "chat" | "generation" = $state("chat");
let expandedGenerationModels = $state<Set<string>>(new Set());
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

function getGenerationModelTitle(model: PublicGenerationDeclaration): string {
	return model.title?.trim() || model.model;
}

function getGenerationKind(model: PublicGenerationDeclaration): string {
	const inputTypes = new Set(model.content.input.map((item) => item.type));
	if (inputTypes.has("video")) return "Video";
	if (inputTypes.has("image")) return "Image";
	return "Multimodal";
}

function getEnumParameters(
	model: PublicGenerationDeclaration,
): Array<{ name: string; values: Array<string | number | boolean> }> {
	return Object.entries(model.parameters ?? {}).flatMap(([name, spec]) => {
		if (
			!("enum" in spec) ||
			!Array.isArray(spec.enum) ||
			spec.enum.length === 0
		)
			return [];
		const values = spec.enum.filter(
			(value): value is string | number | boolean =>
				typeof value === "string" ||
				typeof value === "number" ||
				typeof value === "boolean",
		);
		return values.length > 0 ? [{ name, values }] : [];
	});
}

function getParameterRows(
	model: PublicGenerationDeclaration,
): Array<{ name: string; detail: string }> {
	return Object.entries(model.parameters ?? {}).map(([name, spec]) => {
		if ("enum" in spec && Array.isArray(spec.enum) && spec.enum.length > 0) {
			const selectedCount = getSelectedEnumValues(
				model.model,
				name,
				spec.enum,
			).size;
			return selectedCount >= spec.enum.length
				? { name, detail: "All values" }
				: { name, detail: `${selectedCount}/${spec.enum.length} values` };
		}
		return { name, detail: "Auto" };
	});
}

function getSelectedEnumValues(
	model: string,
	parameter: string,
	values: unknown[],
): Set<string> {
	return (
		generationEnumSelections[model]?.[parameter] ?? new Set(values.map(String))
	);
}

function isGenerationModelExpanded(model: string): boolean {
	return expandedGenerationModels.has(model);
}

function toggleGenerationModelExpanded(model: string) {
	const next = new Set(expandedGenerationModels);
	if (next.has(model)) next.delete(model);
	else next.add(model);
	expandedGenerationModels = next;
}

function toggleGenerationEnumValue(
	modelId: string,
	parameter: string,
	value: string,
	selected: boolean,
) {
	if (!selected) {
		const model = generationModels.find((item) => item.model === modelId);
		const enumParam = model
			? getEnumParameters(model).find((item) => item.name === parameter)
			: null;
		const selectedValues = enumParam
			? getSelectedEnumValues(modelId, parameter, enumParam.values)
			: null;
		if (selectedValues?.size === 1 && selectedValues.has(value)) return;
	}
	onGenerationEnumValueToggle?.(modelId, parameter, value, selected);
}

function setGenerationMode(mode: "auto" | "limited") {
	onGenerationPolicyModeChange?.(mode);
}

function toggleGenerationModel(model: string, selected: boolean) {
	onGenerationModelToggle?.(model, selected);
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
	if (activeTab !== "chat") return;
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

function handleNavigationKeydown(e: KeyboardEvent) {
	if (!open || e.defaultPrevented || isComposingKeyboardEvent(e)) return;
	const key = e.key.toLowerCase();
	if (e.key === "Escape") {
		e.preventDefault();
		e.stopPropagation();
		e.stopImmediatePropagation?.();
		onClose();
		return;
	}
	if (e.key === "ArrowDown" || (e.ctrlKey && key === "n")) {
		e.preventDefault();
		e.stopPropagation();
		e.stopImmediatePropagation();
		moveSelection(1);
		return;
	}
	if (e.key === "ArrowUp" || (e.ctrlKey && key === "p")) {
		e.preventDefault();
		e.stopPropagation();
		e.stopImmediatePropagation();
		moveSelection(-1);
		return;
	}
	if (
		e.key === "Enter" &&
		activeTab === "chat" &&
		filteredModels[selectedIndex]
	) {
		e.preventDefault();
		e.stopPropagation();
		e.stopImmediatePropagation();
		const selected = filteredModels[selectedIndex];
		onSelect({ provider: selected.provider, id: selected.id });
	}
}

function handleKeyDown(e: KeyboardEvent) {
	handleNavigationKeydown(e);
}

$effect(() => {
	if (selectedIndex >= filteredModels.length) {
		selectedIndex = Math.max(filteredModels.length - 1, 0);
	}
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

<Dialog {open} {onClose} title="Models" maxWidth="520px">
	<div class="px-3 pt-3 border-b border-border-subtle">
		<div class="flex rounded-md bg-bg-subtle p-0.5 text-[12px]">
			<button
				type="button"
				class={`flex-1 rounded px-2 py-1.5 font-medium transition-colors ${activeTab === "chat" ? "bg-bg-surface text-text-primary" : "text-text-tertiary hover:text-text-primary"}`}
				onclick={() => {
					activeTab = "chat";
					focusSearchInputSoon();
				}}
			>
				Chat
			</button>
			<button
				type="button"
				class={`flex-1 rounded px-2 py-1.5 font-medium transition-colors ${activeTab === "generation" ? "bg-bg-surface text-text-primary" : "text-text-tertiary hover:text-text-primary"}`}
				onclick={() => {
					activeTab = "generation";
					onGenerationTabOpen?.();
				}}
			>
				Generation
			</button>
		</div>
	</div>

	{#if activeTab === "chat"}
		<div class="px-3 pt-3 pb-2 border-b border-border-subtle">
			<input
				bind:this={searchInputEl}
				data-model-selector-search="true"
				type="text"
				placeholder="Search models..."
				bind:value={searchQuery}
				onkeydown={handleKeyDown}
				class="w-full bg-bg-input border border-border-subtle rounded-md px-3 py-2 text-[13px] text-text-primary outline-none placeholder:text-text-placeholder focus:border-brand/40"
			/>
		</div>

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
						} ${index === selectedIndex ? "bg-bg-hover" : ""}`}
						data-model-item
						onclick={() => onSelect({ provider: item.provider, id: item.id })}
						onmouseenter={() => {
							if (navigationMode === "mouse") {
								selectedIndex = index;
							}
						}}
						aria-pressed={isCurrentModel(item)}
						data-selected={index === selectedIndex}
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
	{:else}
		<div class="flex-1 overflow-y-auto px-4 py-3">
			<div class="space-y-2">
				<button
					type="button"
					class={`w-full rounded-md border px-3 py-2 text-left transition-colors ${generationPolicyMode === "auto" ? "border-brand/50 bg-brand-bg" : "border-border-subtle hover:bg-bg-hover"}`}
					onclick={() => setGenerationMode("auto")}
				>
					<div class="flex items-center justify-between gap-3">
						<div>
							<div class="text-[13px] font-medium text-text-primary">Auto</div>
							<div class="mt-0.5 text-[12px] text-text-tertiary">Use any available image or video generation model.</div>
						</div>
						<span class="text-[12px] text-brand-muted-fg">{generationPolicyMode === "auto" ? "Active" : ""}</span>
					</div>
				</button>

				<button
					type="button"
					class={`w-full rounded-md border px-3 py-2 text-left transition-colors ${generationPolicyMode === "limited" ? "border-brand/50 bg-brand-bg" : "border-border-subtle hover:bg-bg-hover"}`}
					onclick={() => setGenerationMode("limited")}
				>
					<div class="flex items-center justify-between gap-3">
						<div>
							<div class="text-[13px] font-medium text-text-primary">Limited</div>
							<div class="mt-0.5 text-[12px] text-text-tertiary">Use selected generation models for this turn.</div>
						</div>
						<span class="text-[12px] text-brand-muted-fg">{generationPolicyMode === "limited" ? "Active" : ""}</span>
					</div>
				</button>
			</div>

			<div class="mt-4 flex items-center justify-between gap-3">
				<div class="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">Generation models</div>
				<div class="text-[12px] text-text-tertiary">Applies to this turn only.</div>
			</div>

			{#if generationModels.length === 0}
				<div class="mt-3 rounded-md border border-border-subtle px-3 py-4 text-center text-[13px] text-text-tertiary">
					No generation models available
				</div>
			{:else}
				<div class="mt-2 divide-y divide-border-subtle rounded-md border border-border-subtle">
					{#each generationModels as model (model.model)}
						<div class="px-3 py-2.5 transition-colors hover:bg-bg-hover/50">
							<div class="flex items-start gap-2">
								<input
									type="checkbox"
									aria-label={`Use ${getGenerationModelTitle(model)} for this turn`}
									class="mt-1 h-3.5 w-3.5 accent-brand"
									disabled={generationPolicyMode !== "limited"}
									checked={selectedGenerationModels.has(model.model)}
									onchange={(event) => toggleGenerationModel(model.model, event.currentTarget.checked)}
								/>
								<div class="min-w-0 flex-1">
									<div class="flex items-start justify-between gap-2">
										<button
											type="button"
											class="min-w-0 flex-1 text-left"
											onclick={() => toggleGenerationModelExpanded(model.model)}
											aria-expanded={isGenerationModelExpanded(model.model)}
										>
											<div class="flex items-center gap-2">
												<ChevronDown class={`h-3.5 w-3.5 shrink-0 text-text-tertiary transition-transform ${isGenerationModelExpanded(model.model) ? "rotate-0" : "-rotate-90"}`} />
												<span class="truncate text-[13px] font-medium text-text-primary">{getGenerationModelTitle(model)}</span>
												<span class="rounded border border-border-subtle px-1.5 py-0.5 text-[10px] text-text-tertiary">{getGenerationKind(model)}</span>
											</div>
											<div class="mt-0.5 truncate pl-5 text-[12px] text-text-tertiary">{model.model}</div>
										</button>
										{#if generationPolicyMode === "limited" && selectedGenerationModels.has(model.model)}
											<span class="mt-0.5 rounded bg-brand-bg px-1.5 py-0.5 text-[10px] font-medium text-brand-muted-fg">Selected</span>
										{/if}
									</div>

									{#if isGenerationModelExpanded(model.model)}
										{#if getParameterRows(model).length > 0}
											<div class="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 pl-5 text-[11px]">
												{#each getParameterRows(model) as param (param.name)}
													<span class="truncate text-text-secondary">{param.name}</span>
													<span class="text-text-tertiary">{param.detail}</span>
												{/each}
											</div>
										{/if}

										{#if getEnumParameters(model).length > 0}
											<div class="mt-2 space-y-2 pl-5">
												{#each getEnumParameters(model) as param (param.name)}
													<div class="rounded-md border border-border-subtle bg-bg-subtle/40 p-2">
														<div class="mb-1.5 flex items-center justify-between gap-2">
															<div class="text-[11px] font-medium text-text-secondary">{param.name}</div>
															<div class="text-[10px] text-text-tertiary">Enum</div>
														</div>
														<div class="flex flex-wrap gap-1.5">
															{#each param.values as value (String(value))}
																<label class={`inline-flex items-center gap-1 rounded border px-1.5 py-1 text-[11px] transition-colors ${selectedGenerationModels.has(model.model) && getSelectedEnumValues(model.model, param.name, param.values).has(String(value)) ? "border-brand/40 bg-brand-bg text-brand-muted-fg" : "border-border-subtle bg-bg-surface text-text-tertiary hover:text-text-primary"}`}>
																	<input
																		type="checkbox"
																		class="h-3 w-3 accent-brand"
																		disabled={generationPolicyMode !== "limited" || !selectedGenerationModels.has(model.model) || (getSelectedEnumValues(model.model, param.name, param.values).size === 1 && getSelectedEnumValues(model.model, param.name, param.values).has(String(value)))}
																		checked={getSelectedEnumValues(model.model, param.name, param.values).has(String(value))}
																		onchange={(event) => toggleGenerationEnumValue(model.model, param.name, String(value), event.currentTarget.checked)}
																	/>
																	<span>{String(value)}</span>
																</label>
															{/each}
														</div>
													</div>
												{/each}
											</div>
										{/if}
									{/if}
								</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</Dialog>
