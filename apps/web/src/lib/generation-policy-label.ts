export type GenerationPolicyLabelModel = {
	model: string;
	title?: string | null;
};

export type FormatGenerationPolicyLabelInput = {
	mode: "auto" | "limited";
	selectedModels: Iterable<string>;
	catalog?: readonly GenerationPolicyLabelModel[] | null;
	/** Prefer names when count <= this (default 2). */
	maxNames?: number;
	/** Soft character budget for joined names (default 22). */
	maxChars?: number;
};

const DEFAULT_MAX_NAMES = 2;
const DEFAULT_MAX_CHARS = 22;
const SINGLE_NAME_MAX = 14;

function shortModelLabel(modelId: string, title?: string | null): string {
	const raw = title?.trim() || modelId.trim();
	if (!raw) return modelId;
	const base = raw.includes("/") ? (raw.split("/").pop() ?? raw) : raw;
	if (base.length <= SINGLE_NAME_MAX) return base;
	return `${base.slice(0, SINGLE_NAME_MAX - 1)}…`;
}

function uniqueModelIds(selectedModels: Iterable<string>): string[] {
	const seen = new Set<string>();
	const ids: string[] = [];
	for (const raw of selectedModels) {
		const modelId = raw.trim();
		if (!modelId || seen.has(modelId)) continue;
		seen.add(modelId);
		ids.push(modelId);
	}
	return ids;
}

/** Keep selector list order when possible; unknown models follow in selection order. */
function orderSelectedModels(
	selected: string[],
	catalog: readonly GenerationPolicyLabelModel[] | null | undefined,
): string[] {
	if (!catalog?.length || selected.length <= 1) return selected;

	const selectedSet = new Set(selected);
	const ordered: string[] = [];
	for (const item of catalog) {
		if (selectedSet.has(item.model)) ordered.push(item.model);
	}
	if (ordered.length === selected.length) return ordered;

	const inCatalog = new Set(ordered);
	for (const modelId of selected) {
		if (!inCatalog.has(modelId)) ordered.push(modelId);
	}
	return ordered;
}

/**
 * Compact generation-policy suffix for the composer model control.
 * Returns null when mode is Auto (caller should hide entirely).
 */
export function formatGenerationPolicyLabel(
	input: FormatGenerationPolicyLabelInput,
): string | null {
	if (input.mode !== "limited") return null;

	const maxNames = input.maxNames ?? DEFAULT_MAX_NAMES;
	const maxChars = input.maxChars ?? DEFAULT_MAX_CHARS;
	const selected = orderSelectedModels(
		uniqueModelIds(input.selectedModels),
		input.catalog,
	);
	if (selected.length === 0) return "Gen 0";

	const catalogById = new Map(
		(input.catalog ?? []).map((item) => [item.model, item] as const),
	);
	const names = selected.map((modelId) => {
		const item = catalogById.get(modelId);
		return shortModelLabel(modelId, item?.title);
	});

	if (names.length > maxNames) return `Gen ${names.length}`;

	const joined = names.join(" · ");
	if (joined.length > maxChars) return `Gen ${names.length}`;
	return joined;
}
