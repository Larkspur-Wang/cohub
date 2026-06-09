export type ModelCatalogItem = {
	provider: string;
	id: string;
	model: Record<string, unknown> & { hidden?: boolean };
};

export function isModelHidden(item: ModelCatalogItem): boolean {
	return item.model.hidden === true;
}

export type ModelCatalogIndex = {
	byProviderAndId: Map<string, ModelCatalogItem>;
	uniqueById: Map<string, ModelCatalogItem>;
};

const catalogIndexCache = new WeakMap<ModelCatalogItem[], ModelCatalogIndex>();

function getCatalogModelName(item: ModelCatalogItem | null | undefined) {
	const name = item?.model?.name;
	return typeof name === "string" && name.trim() ? name.trim() : "";
}

function providerModelKey(provider: string, model: string) {
	return `${provider}\u0000${model}`;
}

export function getModelCatalogIndex(
	modelsCatalog: ModelCatalogItem[] | null | undefined,
): ModelCatalogIndex | null {
	if (!modelsCatalog?.length) return null;
	const cached = catalogIndexCache.get(modelsCatalog);
	if (cached) return cached;

	const byProviderAndId = new Map<string, ModelCatalogItem>();
	const byId = new Map<string, ModelCatalogItem[]>();
	for (const item of modelsCatalog) {
		byProviderAndId.set(providerModelKey(item.provider, item.id), item);
		const matches = byId.get(item.id);
		if (matches) matches.push(item);
		else byId.set(item.id, [item]);
	}
	const uniqueById = new Map<string, ModelCatalogItem>();
	for (const [id, matches] of byId) {
		if (matches.length === 1 && matches[0]) uniqueById.set(id, matches[0]);
	}
	const index = { byProviderAndId, uniqueById };
	catalogIndexCache.set(modelsCatalog, index);
	return index;
}

export function findModelCatalogItem(
	modelsCatalog: ModelCatalogItem[] | ModelCatalogIndex | null | undefined,
	input: { provider?: string | null; model?: string | null },
): ModelCatalogItem | null {
	const model = input.model?.trim();
	if (!model || !modelsCatalog) return null;
	const index = Array.isArray(modelsCatalog)
		? getModelCatalogIndex(modelsCatalog)
		: modelsCatalog;
	if (!index) return null;
	const provider = input.provider?.trim();
	if (provider) {
		const providerMatch = index.byProviderAndId.get(
			providerModelKey(provider, model),
		);
		if (providerMatch) return providerMatch;
	}
	return index.uniqueById.get(model) ?? null;
}

export function getModelDisplayName(
	modelsCatalog: ModelCatalogItem[] | ModelCatalogIndex | null | undefined,
	input: { provider?: string | null; model?: string | null },
) {
	const model = input.model?.trim() ?? "";
	if (!model) return "";
	return (
		getCatalogModelName(findModelCatalogItem(modelsCatalog, input)) || model
	);
}
