export const buildSpaceRootRoute = (spaceId: string) => `/spaces/${spaceId}`;

export const buildUserProfileRoute = (username: string) =>
	`/${encodeURIComponent(username)}`;

/** Public guest profile href when the user has a username; otherwise null. */
export function buildUserProfileHref(
	profile: { username?: string | null } | string | null | undefined,
): string | null {
	const username =
		typeof profile === "string"
			? profile.trim()
			: profile?.username?.trim() || "";
	return username ? buildUserProfileRoute(username) : null;
}

export const buildSessionsRoute = () => "/sessions";

export const buildUserSessionRoute = (sessionId: string) =>
	`/sessions/${sessionId}`;

export const buildSpaceSessionRoute = (spaceId: string, sessionId: string) =>
	`/spaces/${spaceId}/sessions/${sessionId}`;
export const buildSpaceNewSessionRoute = (spaceId: string) =>
	buildSpaceSessionRoute(spaceId, "new");

export const buildSpaceLandingRoute = (spaceId: string) =>
	buildSpaceNewSessionRoute(spaceId);

export const buildSpaceSettingsRoute = (spaceId: string) =>
	`/spaces/${spaceId}/settings`;

export const buildSpaceSessionTurnRoute = (
	spaceId: string,
	sessionId: string,
	sequence: number,
) => {
	const params = new URLSearchParams({ turn: String(sequence) });
	return `${buildSpaceSessionRoute(spaceId, sessionId)}?${params.toString()}`;
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

export const buildSpaceWorkRoute = (spaceId: string, workId: string) =>
	`/spaces/${spaceId}/works/${workId}`;

export const buildSpaceTaskRoute = (spaceId: string, taskId: string) =>
	`/spaces/${spaceId}/tasks/${taskId}`;
