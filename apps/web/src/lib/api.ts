import type {
	ChannelConfig,
	ContentBlock,
	MessageRecord,
	SessionBindingRecord as ProtocolSessionBindingRecord,
	SessionRecord as ProtocolSessionRecord,
	ResourcePermissionLevel,
} from "@cohub/protocol";
import { PUBLIC_API_ORIGIN } from "$env/static/public";
import {
	clearAuthToken as clearStoredAuthToken,
	getAuthToken,
	logtoClient,
	setAuthToken as setStoredAuthToken,
} from "$lib/auth";

export type {
	ChannelConfig,
	DiscordChannelConfig,
	ResourcePermissionLevel,
} from "@cohub/protocol";

// Space FS types (moved to SpaceFs* in protocol; kept locally for web compat)
export type SpaceFsEntry = {
	name: string;
	path: string;
	type: "file" | "dir" | "symlink";
	size: number;
	mimeType: string | null;
	mtimeMs: number;
};
export type SpaceFsTreeResponse = { path: string; entries: SpaceFsEntry[] };
export type SpaceFsFileKind = "text" | "binary";
export type SpaceFsEncoding = "utf-8" | "base64";
export type SpaceFsFileResponse = {
	path: string;
	name: string;
	size: number;
	mimeType: string | null;
	mtimeMs: number;
	kind: SpaceFsFileKind;
	encoding: SpaceFsEncoding;
	content: string;
};
export type SpaceFsWriteFileInput = {
	path: string;
	content: string;
	encoding: SpaceFsEncoding;
};
export type SpaceFsMoveInput = { fromPath: string; toPath: string };

const API_BASE_URL = PUBLIC_API_ORIGIN ?? "";

type ApiError = {
	message: string;
};

type Fetch = typeof globalThis.fetch;

// ─── Re-export protocol types with web-specific extensions ───

export type { ContentBlock, MessageRecord };

export type SessionBindingRecord = ProtocolSessionBindingRecord;

/** Web-extended session record with computed fields from API responses */
export type SessionRecord = ProtocolSessionRecord & {
	bindings?: SessionBindingRecord[];
	totalMessages?: number;
	totalToolCalls?: number;
	totalInputTokens?: number;
	totalOutputTokens?: number;
	totalCost?: string | number | null;
	shareLevel?: ResourcePermissionLevel | null;
};

/** Space record (mirrors the DB schema; protocol type was removed in v2) */
export type SpaceRecord = {
	id: string;
	userUuid: string;
	name: string | null;
	description: string | null;
	storageRepoName?: string | null;
	baseCheckpointId?: string | null;
	headCheckpointId?: string | null;
	title: string | null;
	status: string | null;
	sandboxStatus?: string | null;
	meta: Record<string, unknown> | null;
	createdAt: string;
	updatedAt: string;
	channels?: {
		id: string;
		name: string | null;
		provider: string;
		status: string;
	}[];
};

export type SpaceBootstrapSource =
	| { type: "blank" }
	| { type: "git_repo"; repoUrl?: string; ref?: string | null }
	| { type: "checkpoint"; checkpointId: string };

export type SpaceCreateResponse = {
	space: SpaceRecord;
	taskRunId: string;
};

/** Web-extended space record with live status and channels */
export type SpaceListItem = SpaceRecord;

export type SessionMessagesResponse = {
	space: SpaceRecord;
	session: SessionRecord;
	messages: MessageRecord[];
};

export type SessionMessagesPaginatedResponse = {
	space: SpaceRecord;
	session: SessionRecord;
	messages: MessageRecord[];
	hasMore: boolean;
	nextCursor: number | undefined;
};

const withAuthorization = async (init?: RequestInit): Promise<RequestInit> => {
	const headers = new Headers(init?.headers);
	const token = await getAuthToken();

	if (token) {
		headers.set("Authorization", `Bearer ${token}`);
	} else {
		headers.delete("Authorization");
	}

	return {
		...init,
		headers,
	};
};

const apiFetch = async (
	path: string,
	init?: RequestInit & { fetch?: Fetch },
) => {
	const fetcher = init?.fetch ?? fetch;
	const url = API_BASE_URL ? `${API_BASE_URL}${path}` : path;

	const response = await fetcher(url, await withAuthorization(init));

	if (response.status === 401 && typeof window !== "undefined") {
		await logtoClient.signIn(`${window.location.origin}/callback`);
		throw new Error("unauthorized");
	}

	if (!response.ok) {
		const contentType = response.headers.get("content-type") ?? "";
		const message = contentType.includes("application/json")
			? JSON.stringify(await response.json().catch(() => null))
			: await response.text().catch(() => response.statusText);
		throw new Error(message || response.statusText);
	}

	if (response.status === 204) {
		return null;
	}

	return response.json();
};

export const setAuthToken = async (token: string) => {
	const trimmedToken = token.trim();
	const response = await fetch(
		API_BASE_URL ? `${API_BASE_URL}/api/me` : "/api/me",
		{
			headers: {
				Authorization: `Bearer ${trimmedToken}`,
			},
		},
	);

	if (!response.ok) {
		const contentType = response.headers.get("content-type") ?? "";
		const message = contentType.includes("application/json")
			? JSON.stringify(await response.json().catch(() => null))
			: await response.text().catch(() => response.statusText);
		throw new Error(message || response.statusText);
	}

	setStoredAuthToken(trimmedToken);
	return response.json();
};

export const clearAuthToken = async () => {
	clearStoredAuthToken();
	return null;
};

export const getMe = async (customFetch?: Fetch) => {
	return apiFetch("/api/me", { fetch: customFetch });
};

export type ModelCatalogEntry = {
	provider: string;
	id: string;
	model: Record<string, unknown>;
};

export const getModels = async (customFetch?: Fetch) => {
	// Public endpoint — no auth required
	const fetcher = customFetch ?? fetch;
	const url = API_BASE_URL ? `${API_BASE_URL}/api/models` : "/api/models";
	const response = await fetcher(url);
	if (!response.ok) {
		throw new Error(
			`Failed to fetch models: ${response.status} ${response.statusText}`,
		);
	}
	return response.json() as Promise<Record<string, ModelCatalogEntry[]>>;
};

export const getSession = async (id: string, customFetch?: Fetch) => {
	return apiFetch(`/api/sessions/${id}`, {
		fetch: customFetch,
	}) as Promise<{ space: SpaceRecord; session: SessionRecord }>;
};

export const getSessionMessages = async (id: string, customFetch?: Fetch) => {
	return apiFetch(`/api/sessions/${id}/messages`, {
		fetch: customFetch,
	}) as Promise<SessionMessagesResponse>;
};

export const getSessionMessagesPaginated = async (
	id: string,
	options?: {
		cursor?: number;
		limit?: number;
		direction?: "older" | "newer";
	},
	customFetch?: Fetch,
) => {
	const params = new URLSearchParams();
	if (options?.cursor !== undefined)
		params.set("cursor", String(options.cursor));
	if (options?.limit !== undefined) params.set("limit", String(options.limit));
	if (options?.direction) params.set("direction", options.direction);
	const query = params.toString();
	return apiFetch(`/api/sessions/${id}/messages${query ? `?${query}` : ""}`, {
		fetch: customFetch,
	}) as Promise<SessionMessagesPaginatedResponse>;
};

// ─── Simple client-side dedup: reject identical payload in same session within 2s ───
let lastSentSignature = "";
let lastSentSessionId = "";
let lastSentAt = 0;
const DEDUP_WINDOW_MS = 2000;

export const postSessionMessage = async (
	sessionId: string,
	content: ContentBlock[],
	options?: { model?: string; provider?: string; clientMessageId?: string },
) => {
	const signature = JSON.stringify({ sessionId, content, options });

	const now = Date.now();
	if (
		sessionId === lastSentSessionId &&
		signature === lastSentSignature &&
		now - lastSentAt < DEDUP_WINDOW_MS
	) {
		throw new Error("Duplicate message ignored");
	}
	lastSentSessionId = sessionId;
	lastSentSignature = signature;
	lastSentAt = now;

	return apiFetch(`/api/sessions/${sessionId}/messages`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			content,
			model: options?.model,
			provider: options?.provider,
			clientMessageId: options?.clientMessageId,
		}),
	}) as Promise<{ ok: true; userMessageId: string }>;
};

export type { ApiError };

export type Channel = {
	id: string;
	userUuid: string;
	provider: string;
	name: string;
	status: string;
	createdAt: string;
	updatedAt: string;
	boundSpace: {
		id: string;
		title: string | null;
		status: string;
	} | null;
};

export type SpaceEnvInput = {
	name: string;
	value: string;
};

export type SpaceChannelBindingInput = {
	channelId: string;
	config?: ChannelConfig | null;
};

export type SpaceSessionsResponse = {
	space: SpaceRecord;
	sessions: SessionRecord[];
};

export const createSpace = async (
	input?: {
		name?: string;
		description?: string;
		source?: string;
		extraEnv?: SpaceEnvInput[];
		channelBindings?: SpaceChannelBindingInput[];
		bootstrapSource?: SpaceBootstrapSource;
	},
	headers?: Record<string, string>,
) => {
	return apiFetch("/api/spaces", {
		method: "POST",
		headers: {
			...headers,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(input ?? {}),
	}) as Promise<SpaceCreateResponse>;
};

export const getSpaces = async (customFetch?: Fetch) => {
	return apiFetch("/api/spaces", {
		method: "GET",
		fetch: customFetch,
	}) as Promise<SpaceRecord[]>;
};

export const getSpace = async (id: string, customFetch?: Fetch) => {
	return apiFetch(`/api/spaces/${id}`, {
		fetch: customFetch,
	}) as Promise<SpaceRecord>;
};

export const createSpaceSession = async (
	id: string,
	input?: {
		title?: string;
		source?: string;
	},
) => {
	return apiFetch(`/api/spaces/${id}/sessions`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(input ?? {}),
	}) as Promise<{ ok: true; session: SessionRecord }>;
};

export const getSpaceSessions = async (id: string, customFetch?: Fetch) => {
	return apiFetch(`/api/spaces/${id}/sessions`, {
		fetch: customFetch,
	}) as Promise<SpaceSessionsResponse>;
};

export const getSpaceFsTree = async (
	spaceId: string,
	path = "",
	customFetch?: Fetch,
) => {
	const params = new URLSearchParams();
	if (path) params.set("path", path);
	const query = params.toString();
	return apiFetch(`/api/spaces/${spaceId}/fs/tree${query ? `?${query}` : ""}`, {
		fetch: customFetch,
	}) as Promise<SpaceFsTreeResponse>;
};

export const getSpaceFsFile = async (
	spaceId: string,
	path: string,
	customFetch?: Fetch,
) => {
	const params = new URLSearchParams({ path });
	return apiFetch(`/api/spaces/${spaceId}/fs/file?${params.toString()}`, {
		fetch: customFetch,
	}) as Promise<SpaceFsFileResponse>;
};

export const getSpaceFsDownloadUrl = (
	spaceId: string,
	path: string,
): string => {
	const params = new URLSearchParams({ path });
	return `/api/spaces/${spaceId}/fs/download?${params.toString()}`;
};

export const triggerSpaceFsDownload = (spaceId: string, path: string) => {
	const url = getSpaceFsDownloadUrl(spaceId, path);
	const a = document.createElement("a");
	a.href = url;
	a.download = path.split("/").pop() ?? "download";
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
};

export const putSpaceFsFile = async (
	spaceId: string,
	input: SpaceFsWriteFileInput,
) => {
	return apiFetch(`/api/spaces/${spaceId}/fs/file`, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	}) as Promise<{ ok: true; path: string; size: number; mtimeMs: number }>;
};

export const createSpaceFsDir = async (spaceId: string, path: string) => {
	return apiFetch(`/api/spaces/${spaceId}/fs/dir`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ path }),
	}) as Promise<{ ok: true; path: string; size: number; mtimeMs: number }>;
};

export const deleteSpaceFsNode = async (
	spaceId: string,
	path: string,
	recursive = false,
) => {
	const params = new URLSearchParams({ path });
	if (recursive) params.set("recursive", "true");
	return apiFetch(`/api/spaces/${spaceId}/fs/node?${params.toString()}`, {
		method: "DELETE",
	}) as Promise<{ ok: true; path: string }>;
};

export const moveSpaceFsNode = async (
	spaceId: string,
	input: SpaceFsMoveInput,
) => {
	return apiFetch(`/api/spaces/${spaceId}/fs/move`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	}) as Promise<{ ok: true; fromPath: string; toPath: string }>;
};

export const getChannels = async (customFetch?: Fetch) => {
	return apiFetch("/api/channels", {
		method: "GET",
		fetch: customFetch,
	}) as Promise<Channel[]>;
};

export const createChannel = async (data: {
	provider: string;
	name: string;
	credentials: Record<string, unknown>;
}) => {
	return apiFetch("/api/channels", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(data),
	});
};

export const deleteChannel = async (id: string) => {
	return apiFetch(`/api/channels/${id}`, { method: "DELETE" });
};

export type UserSshKey = {
	id: string;
	key: string;
	title: string;
	giteaKeyId: number;
	createdAt: string;
};

export const getSshKeys = async (customFetch?: Fetch) => {
	return apiFetch("/api/user/ssh-keys", {
		method: "GET",
		fetch: customFetch,
	}) as Promise<UserSshKey[]>;
};

export const createSshKey = async (data: { key: string; title: string }) => {
	return apiFetch("/api/user/ssh-keys", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(data),
	}) as Promise<UserSshKey>;
};

export const deleteSshKey = async (id: string) => {
	return apiFetch(`/api/user/ssh-keys/${id}`, {
		method: "DELETE",
	}) as Promise<{ ok: true }>;
};

/** @deprecated 当前前端主链路未使用，保留供后续恢复流式聊天能力。 */
export function extractSessionRenderState(content: ContentBlock[]) {
	const thinkingBlocks = content.filter(
		(b): b is Extract<ContentBlock, { type: "thinking" }> =>
			b.type === "thinking",
	);
	const textBlocks = content.filter(
		(b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text",
	);
	const toolUseBlocks = content.filter(
		(b): b is Extract<ContentBlock, { type: "tool_use" }> =>
			b.type === "tool_use",
	);

	const thinking = thinkingBlocks
		.map((b) => b.thinking)
		.join("\n")
		.trim();
	const answer = textBlocks
		.map((b) => b.text)
		.join("\n")
		.trim();
	const toolCalls = toolUseBlocks.map((b) => ({
		toolCallId: b.id,
		toolName: b.name,
		status:
			(b._meta as { toolStatus?: string } | undefined)?.toolStatus ?? "queued",
		summary: (b._meta as { summary?: string } | undefined)?.summary ?? "",
	}));

	return { thinking, answer, toolCalls };
}

export type CronJobRecord = {
	id: string;
	userUuid: string;
	title: string;
	taskType: string;
	payload: Record<string, unknown>;
	cronExpression: string;
	timezone: string;
	bullJobKey: string;
	spaceId: string | null;
	sessionId: string | null;
	enabled: boolean;
	createdAt: string;
	updatedAt: string;
};

export type TaskRunRecord = {
	id: string;
	jobId: string;
	cronJobId: string | null;
	taskType: string;
	status: "pending" | "running" | "completed" | "failed";
	payload: unknown;
	result: unknown;
	errorMessage: string | null;
	attemptCount: number;
	spaceId: string | null;
	sessionId: string | null;
	userUuid: string | null;
	scheduledAt: string | null;
	startedAt: string | null;
	finishedAt: string | null;
	createdAt: string;
	updatedAt: string;
};

export type CheckpointRecord = {
	id: string;
	spaceId: string;
	commitHash: string;
	description: string;
	parentCheckpointId: string | null;
	forkCount: number;
	meta: Record<string, unknown> | null;
	createdAt: string;
};

export type SpaceCheckpointDetailResponse = {
	checkpoint: CheckpointRecord;
};

export type CreateCronJobInput = {
	title: string;
	taskType: string;
	payload: Record<string, unknown>;
	cronExpression: string;
	timezone?: string;
	spaceId?: string;
	sessionId?: string;
};

export const getCronJobs = async (spaceId?: string) => {
	const query = spaceId ? `?spaceId=${encodeURIComponent(spaceId)}` : "";
	return apiFetch(`/api/cron-jobs${query}`) as Promise<{
		jobs: CronJobRecord[];
	}>;
};

export const createCronJob = async (data: CreateCronJobInput) => {
	return apiFetch("/api/cron-jobs", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(data),
	}) as Promise<CronJobRecord>;
};

export const deleteCronJob = async (id: string) => {
	return apiFetch(`/api/cron-jobs/${id}`, { method: "DELETE" }) as Promise<{
		ok: true;
	}>;
};

export const toggleCronJob = async (id: string, enabled: boolean) => {
	return apiFetch(`/api/cron-jobs/${id}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ enabled }),
	}) as Promise<{ ok: true }>;
};

export const getCronJobRuns = async (cronJobId: string) => {
	return apiFetch(`/api/cron-jobs/${cronJobId}/runs`) as Promise<{
		runs: TaskRunRecord[];
	}>;
};

export type CreateScheduledTaskInput = {
	taskType: string;
	payload: Record<string, unknown>;
	scheduleAt: string;
	spaceId?: string;
	sessionId?: string;
};

export const createScheduledTask = async (data: CreateScheduledTaskInput) => {
	return apiFetch("/api/tasks", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(data),
	}) as Promise<{ ok: true; taskRunId: string; scheduledAt: string }>;
};

export const createSpaceCheckpoint = async (
	spaceId: string,
	description?: string | null,
) => {
	return apiFetch(`/api/spaces/${spaceId}/checkpoints`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ description: description ?? null }),
	}) as Promise<{ ok: true; taskRunId: string }>;
};

export const getSpaceCheckpoints = async (spaceId: string) => {
	return apiFetch(`/api/spaces/${spaceId}/checkpoints`) as Promise<{
		checkpoints: CheckpointRecord[];
	}>;
};

export const getSpaceCheckpoint = async (
	spaceId: string,
	checkpointId: string,
	customFetch?: Fetch,
) => {
	return apiFetch(`/api/spaces/${spaceId}/checkpoints/${checkpointId}`, {
		fetch: customFetch,
	}) as Promise<SpaceCheckpointDetailResponse>;
};

export const getTaskRun = async (taskRunId: string) => {
	return apiFetch(`/api/tasks/${taskRunId}`) as Promise<{
		run: TaskRunRecord;
	}>;
};

export const getTaskRuns = async (filters?: {
	cronJobId?: string;
	spaceId?: string;
}) => {
	const params = new URLSearchParams();
	if (filters?.cronJobId) params.set("cronJobId", filters.cronJobId);
	if (filters?.spaceId) params.set("spaceId", filters.spaceId);
	const query = params.toString();
	return apiFetch(`/api/tasks${query ? `?${query}` : ""}`) as Promise<{
		runs: TaskRunRecord[];
	}>;
};

export type SandboxRecord = {
	id: string;
	spaceId: string;
	status: string;
	podName: string | null;
	lastHeartbeatAt: string | null;
	meta: Record<string, unknown> | null;
	createdAt: string;
	updatedAt: string;
};

export const getSpaceSandbox = async (spaceId: string) => {
	return apiFetch(`/api/spaces/${spaceId}/sandbox`) as Promise<{
		sandbox: SandboxRecord | null;
	}>;
};

export const recreateSpaceSandbox = async (spaceId: string) => {
	return apiFetch(`/api/spaces/${spaceId}/sandbox/recreate`, {
		method: "POST",
	}) as Promise<{ ok: true; message: string }>;
};

// ─── Permission Management ──────────────────────────────

export type ResourcePermission = {
	id: string;
	resourceType: "space" | "session";
	resourceId: string;
	granteeUuid: string | null;
	level: ResourcePermissionLevel;
	createdBy: string;
	createdAt: string;
};

export const createSpacePermission = async (
	spaceId: string,
	level: ResourcePermissionLevel,
) =>
	apiFetch(`/api/spaces/${spaceId}/permissions`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ level }),
	}) as Promise<ResourcePermission>;

export const deleteSpacePermission = async (spaceId: string) =>
	apiFetch(`/api/spaces/${spaceId}/permissions`, {
		method: "DELETE",
	}) as Promise<{ ok: true }>;

export const listSpacePermissions = async (spaceId: string) =>
	apiFetch(`/api/spaces/${spaceId}/permissions`) as Promise<
		ResourcePermission[]
	>;

export const createSessionPermission = async (
	sessionId: string,
	level: ResourcePermissionLevel,
) =>
	apiFetch(`/api/sessions/${sessionId}/permissions`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ level }),
	}) as Promise<ResourcePermission>;

export const deleteSessionPermission = async (sessionId: string) =>
	apiFetch(`/api/sessions/${sessionId}/permissions`, {
		method: "DELETE",
	}) as Promise<{ ok: true }>;

// ─── Collaborator Management ──────────────────────────────

export const addSpaceCollaborator = async (
	spaceId: string,
	granteeUuid: string,
	level: ResourcePermissionLevel,
) =>
	apiFetch(`/api/spaces/${spaceId}/collaborators`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ granteeUuid, level }),
	}) as Promise<ResourcePermission>;

export const listSpaceCollaborators = async (spaceId: string) =>
	apiFetch(`/api/spaces/${spaceId}/collaborators`) as Promise<
		ResourcePermission[]
	>;

export const updateSpaceCollaborator = async (
	spaceId: string,
	granteeUuid: string,
	level: ResourcePermissionLevel,
) =>
	apiFetch(`/api/spaces/${spaceId}/collaborators/${granteeUuid}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ level }),
	}) as Promise<ResourcePermission>;

export const removeSpaceCollaborator = async (
	spaceId: string,
	granteeUuid: string,
) =>
	apiFetch(`/api/spaces/${spaceId}/collaborators/${granteeUuid}`, {
		method: "DELETE",
	}) as Promise<{ ok: true }>;
