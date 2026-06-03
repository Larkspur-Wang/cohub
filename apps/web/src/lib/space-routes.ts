export const buildSpaceDetailRoute = (spaceId: string) => `/spaces/${spaceId}`;

export const buildSpaceSessionRoute = (spaceId: string, sessionId: string) =>
	`/spaces/${spaceId}/sessions/${sessionId}`;

export const buildSpaceSessionTurnRoute = (
	spaceId: string,
	sessionId: string,
	sequence: number,
	options?: { mode?: "chat" | "split" },
) => {
	const params = new URLSearchParams({ turn: String(sequence) });
	if (options?.mode === "split") params.set("mode", "split");
	return `${buildSpaceSessionRoute(spaceId, sessionId)}?${params.toString()}`;
};

export const buildSpaceSessionModeRoute = (
	spaceId: string,
	sessionId: string,
	mode: "chat" | "split",
	sequence?: number | null,
) => {
	const params = new URLSearchParams();
	if (mode === "split") params.set("mode", "split");
	if (
		typeof sequence === "number" &&
		Number.isFinite(sequence) &&
		sequence > 0
	) {
		params.set("turn", String(Math.floor(sequence)));
	}
	const query = params.toString();
	return `${buildSpaceSessionRoute(spaceId, sessionId)}${query ? `?${query}` : ""}`;
};

export const buildSpaceCheckpointRoute = (
	spaceId: string,
	checkpointId: string,
) => `/spaces/${spaceId}/checkpoints/${checkpointId}`;

export const buildSpaceCheckpointNewRoute = (spaceId: string) =>
	`/spaces/${spaceId}/checkpoints/new`;

export const buildSpaceFileRoute = (spaceId: string, path: string) =>
	`/spaces/${spaceId}/files/${path
		.split("/")
		.map((segment) => encodeURIComponent(segment))
		.join("/")}`;

export const buildSpaceCronjobRoute = (spaceId: string, cronjobId: string) =>
	`/spaces/${spaceId}/cronjobs/${cronjobId}`;

export const buildSpaceCronjobNewRoute = (spaceId: string) =>
	`/spaces/${spaceId}/cronjobs/new`;

export const buildSpaceTaskRoute = (spaceId: string, taskId: string) =>
	`/spaces/${spaceId}/tasks/${taskId}`;
