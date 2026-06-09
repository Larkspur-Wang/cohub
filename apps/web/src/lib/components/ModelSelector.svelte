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

type NumericGenerationConstraint = {
	min?: number;
	max?: number;
};

type BooleanGenerationConstraint = {
	value?: boolean;
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
	generationNumericConstraints?: Record<
		string,
		Record<string, NumericGenerationConstraint>
	>;
	generationBooleanConstraints?: Record<
		string,
		Record<string, BooleanGenerationConstraint>
	>;
	onGenerationPolicyModeChange?: (mode: "auto" | "limited") => void;
	onGenerationModelToggle?: (model: string, selected: boolean) => void;
	onGenerationEnumValueToggle?: (
		model: string,
		parameter: string,
		value: string,
		selected: boolean,
	) => void;
	onGenerationNumericConstraintChange?: (
		model: string,
		parameter: string,
		constraint: NumericGenerationConstraint,
	) => void;
	onGenerationBooleanConstraintChange?: (
		model: string,
		parameter: string,
		constraint: BooleanGenerationConstraint,
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
	generationNumericConstraints = {},
	generationBooleanConstraints = {},
	onGenerationPolicyModeChange,
	onGenerationModelToggle,
	onGenerationEnumValueToggle,
	onGenerationNumericConstraintChange,
	onGenerationBooleanConstraintChange,
	onGenerationTabOpen,
}: Props = $props();

let searchQuery = $state("");
let selectedIndex = $state(0);
let navigationMode: "mouse" | "keyboard" = $state("mouse");
let activeTab: "chat" | "generation" = $state("chat");
let expandedGenerationModels = $state<Set<string>>(new Set());
let expandedGenerationParameters = $state<Set<string>>(new Set());
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

const MODEL_COST_CURRENCY_PREFIX = "$";

type ModelCost = {
	input?: unknown;
	output?: unknown;
	cacheRead?: unknown;
	cacheWrite?: unknown;
};

function getModelCost(item: ModelItem): ModelCost | null {
	const cost = item.model.cost;
	return cost && typeof cost === "object" ? (cost as ModelCost) : null;
}

function formatModelCostValue(value: unknown): string | null {
	if (typeof value !== "number" || !Number.isFinite(value)) return null;
	if (value === 0) return `${MODEL_COST_CURRENCY_PREFIX}0`;
	if (Math.abs(value) < 0.01)
		return `${MODEL_COST_CURRENCY_PREFIX}${value.toFixed(4)}`;
	if (Math.abs(value) < 1)
		return `${MODEL_COST_CURRENCY_PREFIX}${value.toFixed(2)}`;
	return `${MODEL_COST_CURRENCY_PREFIX}${value.toFixed(2).replace(/\.00$/, "")}`;
}

function formatModelCost(item: ModelItem): string {
	const cost = getModelCost(item);
	if (!cost) return "";

	const parts = [
		["input", cost.input],
		["output", cost.output],
		["cache read", cost.cacheRead],
		["cache write", cost.cacheWrite],
	].flatMap(([label, value]) => {
		const formatted = formatModelCostValue(value);
		return formatted ? [`${formatted}/M ${label}`] : [];
	});

	return parts.join(" · ");
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

function isEnumParameterSpec(spec: unknown): spec is { enum: unknown[] } {
	return (
		!!spec &&
		typeof spec === "object" &&
		"enum" in spec &&
		Array.isArray(spec.enum) &&
		spec.enum.length > 0
	);
}

function isNumberParameterSpec(spec: unknown): spec is {
	type?: unknown;
	min?: unknown;
	max?: unknown;
} {
	if (!spec || typeof spec !== "object" || isEnumParameterSpec(spec))
		return false;
	const type = "type" in spec ? spec.type : undefined;
	return type === "integer" || type === "number";
}

function isBooleanParameterSpec(spec: unknown): spec is { type?: unknown } {
	if (!spec || typeof spec !== "object" || isEnumParameterSpec(spec))
		return false;
	const type = "type" in spec ? spec.type : undefined;
	return type === "boolean";
}

function getNumberParameterBounds(spec: { min?: unknown; max?: unknown }) {
	const min =
		typeof spec.min === "number" && Number.isFinite(spec.min)
			? spec.min
			: undefined;
	const max =
		typeof spec.max === "number" && Number.isFinite(spec.max)
			? spec.max
			: undefined;
	return { min, max };
}

function getEnumParameters(
	model: PublicGenerationDeclaration,
): Array<{ name: string; values: Array<string | number | boolean> }> {
	return Object.entries(model.parameters ?? {}).flatMap(([name, spec]) => {
		if (!isEnumParameterSpec(spec)) return [];
		const values = spec.enum.filter(
			(value): value is string | number | boolean =>
				typeof value === "string" ||
				typeof value === "number" ||
				typeof value === "boolean",
		);
		return values.length > 0 ? [{ name, values }] : [];
	});
}

function getNumericParameters(model: PublicGenerationDeclaration): Array<{
	name: string;
	kind: "integer" | "number";
	min?: number;
	max?: number;
}> {
	return Object.entries(model.parameters ?? {}).flatMap(([name, spec]) => {
		if (!isNumberParameterSpec(spec)) return [];
		return [
			{
				name,
				kind: spec.type === "integer" ? "integer" : "number",
				...getNumberParameterBounds(spec),
			},
		];
	});
}

function getBooleanParameters(
	model: PublicGenerationDeclaration,
): Array<{ name: string }> {
	return Object.entries(model.parameters ?? {}).flatMap(([name, spec]) =>
		isBooleanParameterSpec(spec) ? [{ name }] : [],
	);
}

function getNumericConstraint(model: string, parameter: string) {
	return generationNumericConstraints[model]?.[parameter] ?? {};
}

function getBooleanConstraint(model: string, parameter: string) {
	return generationBooleanConstraints[model]?.[parameter] ?? {};
}

function getParameterRows(
	model: PublicGenerationDeclaration,
): Array<{ name: string; detail: string }> {
	return Object.entries(model.parameters ?? {}).flatMap(([name, spec]) => {
		if (
			isEnumParameterSpec(spec) ||
			isNumberParameterSpec(spec) ||
			isBooleanParameterSpec(spec)
		) {
			return [];
		}
		return [{ name, detail: "Auto" }];
	});
}

function getEnumParameterDetail(
	model: PublicGenerationDeclaration,
	parameter: string,
	values: Array<string | number | boolean>,
): string {
	const selectedCount = getSelectedEnumValues(
		model.model,
		parameter,
		values,
	).size;
	return selectedCount >= values.length
		? "All values"
		: `${selectedCount}/${values.length} values`;
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

function getGenerationParameterKey(model: string, parameter: string): string {
	return `${model}\u0000${parameter}`;
}

function isGenerationParameterExpanded(
	model: string,
	parameter: string,
): boolean {
	return expandedGenerationParameters.has(
		getGenerationParameterKey(model, parameter),
	);
}

function toggleGenerationParameterExpanded(model: string, parameter: string) {
	const key = getGenerationParameterKey(model, parameter);
	const next = new Set(expandedGenerationParameters);
	if (next.has(key)) next.delete(key);
	else next.add(key);
	expandedGenerationParameters = next;
}

function formatNumericConstraintDetail(
	model: string,
	parameter: string,
	bounds: { min?: number; max?: number },
) {
	const constraint = getNumericConstraint(model, parameter);
	const min = constraint.min ?? bounds.min;
	const max = constraint.max ?? bounds.max;
	if (min === undefined && max === undefined) return "Any value";
	if (min !== undefined && max !== undefined) return `${min}–${max}`;
	return min !== undefined ? `≥ ${min}` : `≤ ${max}`;
}

function formatBooleanConstraintDetail(model: string, parameter: string) {
	const value = getBooleanConstraint(model, parameter).value;
	if (value === true) return "True only";
	if (value === false) return "False only";
	return "Any value";
}

function updateNumericConstraint(
	model: string,
	parameter: string,
	constraint: NumericGenerationConstraint,
) {
	onGenerationNumericConstraintChange?.(model, parameter, constraint);
}

function updateBooleanConstraint(
	model: string,
	parameter: string,
	constraint: BooleanGenerationConstraint,
) {
	onGenerationBooleanConstraintChange?.(model, parameter, constraint);
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
	if (generationPolicyMode !== "limited") {
		setGenerationMode("limited");
	}
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
const selectedGenerationCount = $derived(selectedGenerationModels.size);
</script>

<Dialog {open} {onClose} title="Models" maxWidth="540px">
	<div class="border-b border-border-subtle/70 px-3 py-2">
		<div class="inline-flex rounded-md bg-bg-subtle/70 p-0.5 text-[12px]">
			<button
				type="button"
				class={`rounded px-3 py-1.5 font-medium transition-colors duration-100 ${activeTab === "chat" ? "bg-bg-surface text-text-primary shadow-sm" : "text-text-tertiary hover:text-text-primary"}`}
				onclick={() => {
					activeTab = "chat";
					focusSearchInputSoon();
				}}
			>
				Chat
			</button>
			<button
				type="button"
				class={`rounded px-3 py-1.5 font-medium transition-colors duration-100 ${activeTab === "generation" ? "bg-bg-surface text-text-primary shadow-sm" : "text-text-tertiary hover:text-text-primary"}`}
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
		<div class="border-b border-border-subtle/70 px-3 py-2">
			<input
				bind:this={searchInputEl}
				data-model-selector-search="true"
				type="text"
				placeholder="Search models"
				bind:value={searchQuery}
				onkeydown={handleKeyDown}
				class="w-full rounded-md border-0 bg-bg-input px-3 py-2 text-[13px] text-text-primary outline-none ring-1 ring-border-subtle placeholder:text-text-placeholder transition-shadow duration-100 focus:ring-brand/45"
			/>
		</div>

		<div bind:this={containerEl} class="flex-1 overflow-y-auto py-1">
			{#if filteredModels.length === 0}
				<div class="px-4 py-8 text-center text-[13px] text-text-tertiary">
					{searchQuery ? "No matching models" : "No models available"}
				</div>
			{:else}
				{#each filteredModels as item, index (item.provider + "/" + item.id)}
					{@const costText = formatModelCost(item)}
					<button
						type="button"
						class={`group relative w-full cursor-pointer px-4 py-2 text-left transition-colors duration-100 ${
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
						{#if isCurrentModel(item)}
							<span class="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r bg-brand"></span>
						{/if}
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0 flex-1">
								<div class="flex min-w-0 items-center gap-1.5">
									<span class="truncate text-[13px] font-medium text-text-primary">
										{getDisplayName(item)}
									</span>
									{#if hasVision(item)}
										<Image class="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
									{/if}
								</div>
								{#if costText}
									<div class="mt-0.5 truncate text-[11px] tabular-nums text-text-tertiary/75">
										{costText}
									</div>
								{/if}
							</div>

							<span class="shrink-0 pt-0.5 text-[11px] text-text-tertiary/70">
								{item.provider}
							</span>
						</div>
					</button>
				{/each}
			{/if}
		</div>
	{:else}
		<div class="flex-1 overflow-y-auto px-3 py-3">
			<div class="grid grid-cols-2 gap-1 rounded-md bg-bg-subtle/60 p-1">
				<button
					type="button"
					class={`flex items-center justify-between gap-2 rounded px-2.5 py-1.5 text-left transition-colors duration-100 ${generationPolicyMode === "auto" ? "bg-bg-surface text-text-primary shadow-sm" : "text-text-tertiary hover:text-text-primary"}`}
					onclick={() => setGenerationMode("auto")}
				>
					<span class="text-[13px] font-medium">Auto</span>
					{#if generationPolicyMode === "auto"}<span class="h-1.5 w-1.5 rounded-full bg-brand"></span>{/if}
				</button>

				<button
					type="button"
					class={`flex items-center justify-between gap-2 rounded px-2.5 py-1.5 text-left transition-colors duration-100 ${generationPolicyMode === "limited" ? "bg-bg-surface text-text-primary shadow-sm" : "text-text-tertiary hover:text-text-primary"}`}
					onclick={() => setGenerationMode("limited")}
				>
					<span class="text-[13px] font-medium">Limited</span>
					<span class={`text-[11px] ${generationPolicyMode === "limited" ? "text-brand-muted-fg" : "text-text-tertiary"}`}>{selectedGenerationCount}</span>
				</button>
			</div>

			<div class="mt-3 px-1 text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
				Generation models
			</div>

			{#if generationModels.length === 0}
				<div class="mt-2 px-3 py-6 text-center text-[13px] text-text-tertiary">
					No generation models available
				</div>
			{:else}
				<div class="mt-1.5 -mx-3">
					{#each generationModels as model (model.model)}
						<div class="px-3 py-2 transition-colors duration-100 hover:bg-bg-hover/60">
							<div class="flex items-start gap-2.5">
								<input
									type="checkbox"
									aria-label={`Use ${getGenerationModelTitle(model)} for this turn`}
									class="mt-1 h-3.5 w-3.5 accent-brand"
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
											<div class="flex items-center gap-1.5">
												<ChevronDown class={`h-3.5 w-3.5 shrink-0 text-text-tertiary transition-transform duration-100 ${isGenerationModelExpanded(model.model) ? "rotate-0" : "-rotate-90"}`} />
												<span class="truncate text-[13px] font-medium text-text-primary">{getGenerationModelTitle(model)}</span>
												<span class="text-[10px] text-text-tertiary/80">{getGenerationKind(model)}</span>
											</div>
											<div class="mt-0.5 truncate pl-5 text-[11px] text-text-tertiary">{model.model}</div>
										</button>
										{#if generationPolicyMode === "limited" && selectedGenerationModels.has(model.model)}
											<span class="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-label="Selected"></span>
										{/if}
									</div>

									{#if isGenerationModelExpanded(model.model)}
										<div class="mt-2 space-y-1 pl-5 text-[11px]">
											{#each getParameterRows(model) as param (param.name)}
												<div class="flex items-center justify-between gap-3 rounded-[5px] px-2 py-1 text-text-secondary">
													<span class="truncate">{param.name}</span>
													<span class="shrink-0 text-text-tertiary">{param.detail}</span>
												</div>
											{/each}

											{#each getBooleanParameters(model) as param (param.name)}
												<div class="rounded-[6px] bg-bg-subtle/45">
													<button type="button" class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px] text-text-secondary transition-colors duration-100 hover:text-text-primary" onclick={() => toggleGenerationParameterExpanded(model.model, param.name)} aria-expanded={isGenerationParameterExpanded(model.model, param.name)}>
														<ChevronDown class={`h-3 w-3 shrink-0 text-text-tertiary transition-transform duration-100 ${isGenerationParameterExpanded(model.model, param.name) ? "rotate-0" : "-rotate-90"}`} />
														<span class="min-w-0 flex-1 truncate">{param.name}</span>
														<span class="shrink-0 text-text-tertiary">{formatBooleanConstraintDetail(model.model, param.name)}</span>
													</button>
													{#if isGenerationParameterExpanded(model.model, param.name)}
														<div class="grid grid-cols-3 gap-1 px-2 pb-2 pt-0.5">
															{#each [{ label: 'Any', value: undefined }, { label: 'True', value: true }, { label: 'False', value: false }] as option (option.label)}
																<button type="button" class={`min-h-7 rounded px-2 text-[11px] transition-colors duration-100 ${getBooleanConstraint(model.model, param.name).value === option.value ? "bg-brand-bg text-brand-muted-fg" : "bg-bg-surface text-text-tertiary hover:text-text-primary"}`} disabled={generationPolicyMode !== "limited" || !selectedGenerationModels.has(model.model)} onclick={() => updateBooleanConstraint(model.model, param.name, { value: option.value })}>{option.label}</button>
															{/each}
														</div>
													{/if}
												</div>
											{/each}

											{#each getNumericParameters(model) as param (param.name)}
												{@const constraint = getNumericConstraint(model.model, param.name)}
												<div class="rounded-[6px] bg-bg-subtle/45">
													<button type="button" class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px] text-text-secondary transition-colors duration-100 hover:text-text-primary" onclick={() => toggleGenerationParameterExpanded(model.model, param.name)} aria-expanded={isGenerationParameterExpanded(model.model, param.name)}>
														<ChevronDown class={`h-3 w-3 shrink-0 text-text-tertiary transition-transform duration-100 ${isGenerationParameterExpanded(model.model, param.name) ? "rotate-0" : "-rotate-90"}`} />
														<span class="min-w-0 flex-1 truncate">{param.name}</span>
														<span class="shrink-0 text-text-tertiary">{formatNumericConstraintDetail(model.model, param.name, { min: param.min, max: param.max })}</span>
													</button>
													{#if isGenerationParameterExpanded(model.model, param.name)}
														<div class="grid grid-cols-2 gap-2 px-2 pb-2 pt-0.5">
															<label class="min-w-0 text-[10px] text-text-tertiary"><span>Min</span><input type="number" step={param.kind === "integer" ? "1" : "any"} placeholder={param.min === undefined ? "Any" : String(param.min)} value={constraint.min ?? ""} disabled={generationPolicyMode !== "limited" || !selectedGenerationModels.has(model.model)} class="mt-1 min-h-7 w-full rounded border border-border-subtle bg-bg-input px-2 text-[11px] text-text-primary outline-none focus:border-brand/45 disabled:opacity-50" oninput={(event) => updateNumericConstraint(model.model, param.name, { ...constraint, min: event.currentTarget.value === "" ? undefined : Number(event.currentTarget.value) })} /></label>
															<label class="min-w-0 text-[10px] text-text-tertiary"><span>Max</span><input type="number" step={param.kind === "integer" ? "1" : "any"} placeholder={param.max === undefined ? "Any" : String(param.max)} value={constraint.max ?? ""} disabled={generationPolicyMode !== "limited" || !selectedGenerationModels.has(model.model)} class="mt-1 min-h-7 w-full rounded border border-border-subtle bg-bg-input px-2 text-[11px] text-text-primary outline-none focus:border-brand/45 disabled:opacity-50" oninput={(event) => updateNumericConstraint(model.model, param.name, { ...constraint, max: event.currentTarget.value === "" ? undefined : Number(event.currentTarget.value) })} /></label>
														</div>
													{/if}
												</div>
											{/each}

											{#each getEnumParameters(model) as param (param.name)}
												<div class="rounded-[6px] bg-bg-subtle/45">
													<button type="button" class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px] text-text-secondary transition-colors duration-100 hover:text-text-primary" onclick={() => toggleGenerationParameterExpanded(model.model, param.name)} aria-expanded={isGenerationParameterExpanded(model.model, param.name)}>
														<ChevronDown class={`h-3 w-3 shrink-0 text-text-tertiary transition-transform duration-100 ${isGenerationParameterExpanded(model.model, param.name) ? "rotate-0" : "-rotate-90"}`} />
														<span class="min-w-0 flex-1 truncate">{param.name}</span>
														<span class="shrink-0 text-text-tertiary">{getEnumParameterDetail(model, param.name, param.values)}</span>
													</button>
													{#if isGenerationParameterExpanded(model.model, param.name)}
														<div class="flex flex-wrap gap-1 px-2 pb-2 pt-0.5">
															{#each param.values as value (String(value))}
																<label class={`inline-flex min-h-7 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors duration-100 ${selectedGenerationModels.has(model.model) && getSelectedEnumValues(model.model, param.name, param.values).has(String(value)) ? "bg-brand-bg text-brand-muted-fg" : "bg-bg-surface text-text-tertiary hover:text-text-primary"}`}><input type="checkbox" class="h-3 w-3 accent-brand disabled:opacity-35" disabled={generationPolicyMode !== "limited" || !selectedGenerationModels.has(model.model) || (getSelectedEnumValues(model.model, param.name, param.values).size === 1 && getSelectedEnumValues(model.model, param.name, param.values).has(String(value)))} checked={getSelectedEnumValues(model.model, param.name, param.values).has(String(value))} onchange={(event) => toggleGenerationEnumValue(model.model, param.name, String(value), event.currentTarget.checked)} /><span>{String(value)}</span></label>
															{/each}
														</div>
													{/if}
												</div>
											{/each}
										</div>
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
