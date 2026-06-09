export type ModelCatalogItem = {
	provider: string;
	id: string;
	model: Record<string, unknown>;
};

function getCatalogModelName(item: ModelCatalogItem | null | undefined) {
	const name = item?.model?.name;
	return typeof name === "string" && name.trim() ? name.trim() : "";
}

export function findModelCatalogItem(
	modelsCatalog: ModelCatalogItem[] | null | undefined,
	input: { provider?: string | null; model?: string | null },
): ModelCatalogItem | null {
	const model = input.model?.trim();
	if (!model || !modelsCatalog?.length) return null;
	const provider = input.provider?.trim();
	if (provider) {
		const providerMatch = modelsCatalog.find(
			(item) => item.provider === provider && item.id === model,
		);
		if (providerMatch) return providerMatch;
	}
	const idMatches = modelsCatalog.filter((item) => item.id === model);
	return idMatches.length === 1 ? idMatches[0] : null;
}

export function getModelDisplayName(
	modelsCatalog: ModelCatalogItem[] | null | undefined,
	input: { provider?: string | null; model?: string | null },
) {
	const model = input.model?.trim() ?? "";
	if (!model) return "";
	return (
		getCatalogModelName(findModelCatalogItem(modelsCatalog, input)) || model
	);
}
