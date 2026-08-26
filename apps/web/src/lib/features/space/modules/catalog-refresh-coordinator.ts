export type CatalogRefreshOptions = {
	ensureFresh?: boolean;
};

export function createCatalogRefreshCoordinator(options: {
	getSpaceId: () => string;
	refresh: (spaceId: string) => Promise<void>;
}) {
	const inFlightBySpaceId = new Map<string, Promise<void>>();

	async function refresh(
		targetSpaceId: string,
		refreshOptions: CatalogRefreshOptions = {},
	): Promise<void> {
		const activeRefresh = inFlightBySpaceId.get(targetSpaceId);
		if (activeRefresh) {
			await activeRefresh;
			if (refreshOptions.ensureFresh && options.getSpaceId() === targetSpaceId)
				await refresh(targetSpaceId);
			return;
		}

		const run = options.refresh(targetSpaceId);
		const trackedRun = run.finally(() => {
			if (inFlightBySpaceId.get(targetSpaceId) === trackedRun)
				inFlightBySpaceId.delete(targetSpaceId);
		});
		inFlightBySpaceId.set(targetSpaceId, trackedRun);
		await trackedRun;
	}

	return { refresh };
}
