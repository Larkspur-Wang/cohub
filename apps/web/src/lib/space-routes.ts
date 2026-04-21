export const buildSpaceDetailRoute = (spaceId: string) => `/spaces/${spaceId}`;

export const buildSpaceSessionRoute = (spaceId: string, sessionId: string) =>
	`/spaces/${spaceId}/sessions/${sessionId}`;

export const buildSpaceCheckpointRoute = (spaceId: string, checkpointId: string) =>
	`/spaces/${spaceId}/checkpoints/${checkpointId}`;

export const buildSpaceCheckpointNewRoute = (spaceId: string) =>
	`/spaces/${spaceId}/checkpoints/new`;

export const buildSpaceFileRoute = (spaceId: string, path: string) =>
	`/spaces/${spaceId}/files/${path
		.split("/")
		.map((segment) => encodeURIComponent(segment))
		.join("/")}`;
