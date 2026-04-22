import type {
  ChannelConfig,
  ContentBlock,
  MessageRecord,
  ResourcePermissionLevel,
  SessionBindingRecord as ProtocolSessionBindingRecord,
  SessionRecord as ProtocolSessionRecord,
} from "@cohub/protocol";
import type { WebsocketClientOptions } from "./websocket.js";
import { getWebsocketClient } from "./websocket.js";

export type {
  ChannelConfig,
  DiscordChannelConfig,
  ResourcePermissionLevel,
} from "@cohub/protocol";

export type Fetch = typeof globalThis.fetch;

type ApiError = {
  message: string;
};

export type { ApiError };
export type { ContentBlock, MessageRecord };

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

export type SessionBindingRecord = ProtocolSessionBindingRecord;

export type SessionRecord = ProtocolSessionRecord & {
  bindings?: SessionBindingRecord[];
  totalMessages?: number;
  totalToolCalls?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalCost?: string | number | null;
  shareLevel?: ResourcePermissionLevel | null;
};

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

export type ModelCatalogEntry = {
  provider: string;
  id: string;
  model: Record<string, unknown>;
};

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

export type UserSshKey = {
  id: string;
  key: string;
  title: string;
  giteaKeyId: number;
  createdAt: string;
};

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

export type CreateScheduledTaskInput = {
  taskType: string;
  payload: Record<string, unknown>;
  scheduleAt: string;
  spaceId?: string;
  sessionId?: string;
};

export type ResourcePermission = {
  id: string;
  resourceType: "space" | "session";
  resourceId: string;
  granteeUuid: string | null;
  level: ResourcePermissionLevel;
  createdBy: string;
  createdAt: string;
};

export type CohubClientOptions = {
  baseUrl?: string;
  getAccessToken?: () => Promise<string | null> | string | null;
  onUnauthorized?: () => Promise<void> | void;
  setStoredAuthToken?: (token: string) => void;
  clearStoredAuthToken?: () => void;
  fetch?: Fetch;
  websocket?: WebsocketClientOptions;
};

const DEFAULT_DEDUP_WINDOW_MS = 2000;

class HttpTransport {
  private readonly baseUrl: string;
  private readonly fetcher: Fetch;
  private readonly getAccessToken?: () => Promise<string | null> | string | null;
  private readonly onUnauthorized?: () => Promise<void> | void;

  constructor(options: CohubClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "";
    this.fetcher = options.fetch ?? fetch;
    this.getAccessToken = options.getAccessToken;
    this.onUnauthorized = options.onUnauthorized;
  }

  private async withAuthorization(init?: RequestInit): Promise<RequestInit> {
    const headers = new Headers(init?.headers);
    const token = this.getAccessToken ? await this.getAccessToken() : null;

    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    } else {
      headers.delete("Authorization");
    }

    return {
      ...init,
      headers,
    };
  }

  async request<T>(path: string, init?: RequestInit & { fetch?: Fetch }) {
    const fetcher = init?.fetch ?? this.fetcher;
    const url = this.baseUrl ? `${this.baseUrl}${path}` : path;
    const response = await fetcher(url, await this.withAuthorization(init));

    if (response.status === 401) {
      await this.onUnauthorized?.();
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
      return null as T;
    }

    return response.json() as Promise<T>;
  }
}

class SpacesApi {
  constructor(private readonly transport: HttpTransport) {}

  list(customFetch?: Fetch) {
    return this.transport.request<SpaceRecord[]>("/api/spaces", {
      method: "GET",
      fetch: customFetch,
    });
  }

  get(spaceId: string, customFetch?: Fetch) {
    return this.transport.request<SpaceRecord>(`/api/spaces/${spaceId}`, {
      fetch: customFetch,
    });
  }

  create(
    input?: {
      name?: string;
      description?: string;
      source?: string;
      extraEnv?: SpaceEnvInput[];
      channelBindings?: SpaceChannelBindingInput[];
      bootstrapSource?: SpaceBootstrapSource;
    },
    headers?: Record<string, string>,
  ) {
    return this.transport.request<SpaceCreateResponse>("/api/spaces", {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input ?? {}),
    });
  }
}

class SpaceFilesApi {
  constructor(
    private readonly transport: HttpTransport,
    private readonly spaceId: string,
  ) {}

  list(path = "", customFetch?: Fetch) {
    const params = new URLSearchParams();
    if (path) params.set("path", path);
    const query = params.toString();
    return this.transport.request<SpaceFsTreeResponse>(
      `/api/spaces/${this.spaceId}/fs/tree${query ? `?${query}` : ""}`,
      { fetch: customFetch },
    );
  }

  read(path: string, customFetch?: Fetch) {
    const params = new URLSearchParams({ path });
    return this.transport.request<SpaceFsFileResponse>(
      `/api/spaces/${this.spaceId}/fs/file?${params.toString()}`,
      { fetch: customFetch },
    );
  }

  getDownloadUrl(path: string) {
    const params = new URLSearchParams({ path });
    return `/api/spaces/${this.spaceId}/fs/download?${params.toString()}`;
  }

  triggerDownload(path: string) {
    const url = this.getDownloadUrl(path);
    const a = document.createElement("a");
    a.href = url;
    a.download = path.split("/").pop() ?? "download";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  write(input: SpaceFsWriteFileInput) {
    return this.transport.request<{ ok: true; path: string; size: number; mtimeMs: number }>(
      `/api/spaces/${this.spaceId}/fs/file`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  }

  createDir(path: string) {
    return this.transport.request<{ ok: true; path: string; size: number; mtimeMs: number }>(
      `/api/spaces/${this.spaceId}/fs/dir`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      },
    );
  }

  delete(path: string, recursive = false) {
    const params = new URLSearchParams({ path });
    if (recursive) params.set("recursive", "true");
    return this.transport.request<{ ok: true; path: string }>(
      `/api/spaces/${this.spaceId}/fs/node?${params.toString()}`,
      { method: "DELETE" },
    );
  }

  move(input: SpaceFsMoveInput) {
    return this.transport.request<{ ok: true; fromPath: string; toPath: string }>(
      `/api/spaces/${this.spaceId}/fs/move`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  }
}

class SpaceSessionsApi {
  private lastSentSignature = "";
  private lastSentSessionId = "";
  private lastSentAt = 0;

  constructor(
    private readonly transport: HttpTransport,
    private readonly spaceId: string,
    private readonly websocketClient: ReturnType<typeof getWebsocketClient>,
  ) {}

  private ensureRealtimeConnected() {
    void this.websocketClient.connect().catch((error) => {
      console.error("[CohubClient] Failed to connect realtime websocket:", error);
    });
  }

  create(input?: { title?: string; source?: string }) {
    return this.transport.request<{ ok: true; session: SessionRecord }>(
      `/api/spaces/${this.spaceId}/sessions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input ?? {}),
      },
    );
  }

  list(customFetch?: Fetch) {
    return this.transport.request<SpaceSessionsResponse>(
      `/api/spaces/${this.spaceId}/sessions`,
      {
        fetch: customFetch,
      },
    );
  }

  get(sessionId: string, customFetch?: Fetch) {
    return this.transport.request<{ space: SpaceRecord; session: SessionRecord }>(
      `/api/sessions/${sessionId}`,
      {
        fetch: customFetch,
      },
    );
  }

  listMessages(sessionId: string, customFetch?: Fetch) {
    return this.transport.request<SessionMessagesResponse>(
      `/api/sessions/${sessionId}/messages`,
      {
        fetch: customFetch,
      },
    );
  }

  listMessagesPaginated(
    sessionId: string,
    options?: {
      cursor?: number;
      limit?: number;
      direction?: "older" | "newer";
    },
    customFetch?: Fetch,
  ) {
    const params = new URLSearchParams();
    if (options?.cursor !== undefined) params.set("cursor", String(options.cursor));
    if (options?.limit !== undefined) params.set("limit", String(options.limit));
    if (options?.direction) params.set("direction", options.direction);
    const query = params.toString();
    return this.transport.request<SessionMessagesPaginatedResponse>(
      `/api/sessions/${sessionId}/messages${query ? `?${query}` : ""}`,
      {
        fetch: customFetch,
      },
    );
  }

  async sendMessage(
    sessionId: string,
    content: ContentBlock[],
    options?: { model?: string; provider?: string; clientMessageId?: string },
  ) {
    const signature = JSON.stringify({ sessionId, content, options });
    const now = Date.now();
    if (
      sessionId === this.lastSentSessionId &&
      signature === this.lastSentSignature &&
      now - this.lastSentAt < DEFAULT_DEDUP_WINDOW_MS
    ) {
      throw new Error("Duplicate message ignored");
    }
    this.lastSentSessionId = sessionId;
    this.lastSentSignature = signature;
    this.lastSentAt = now;

    return this.transport.request<{ ok: true; userMessageId: string }>(
      `/api/sessions/${sessionId}/messages`,
      {
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
      },
    );
  }

  subscribe(
    sessionId: string,
    handlers: {
      onProgress?: (event: unknown) => void;
      onFinal?: (event: unknown) => void;
      onError?: (event: unknown) => void;
      onPersisted?: (event: unknown) => void;
    },
  ) {
    this.ensureRealtimeConnected();
    const unsubscribers = [
      this.websocketClient.on("event", (event) => {
        if (event.spaceId !== this.spaceId || event.sessionId !== sessionId) return;
        if (event.type === "session.turn.progress") handlers.onProgress?.(event);
        if (event.type === "session.turn.final") handlers.onFinal?.(event);
        if (event.type === "session.turn.error") handlers.onError?.(event);
        if (event.type === "session.message.persisted") handlers.onPersisted?.(event);
      }),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }
}

class SpaceEventsApi {
  constructor(private readonly websocketClient: ReturnType<typeof getWebsocketClient>) {}

  onEvent(handler: (event: unknown) => void) {
    void this.websocketClient.connect().catch((error) => {
      console.error("[CohubClient] Failed to connect realtime websocket:", error);
    });
    return this.websocketClient.on("event", handler);
  }
}

class SpacePermissionsApi {
  constructor(
    private readonly transport: HttpTransport,
    private readonly spaceId: string,
  ) {}

  create(level: ResourcePermissionLevel) {
    return this.transport.request<ResourcePermission>(
      `/api/spaces/${this.spaceId}/permissions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level }),
      },
    );
  }

  delete() {
    return this.transport.request<{ ok: true }>(
      `/api/spaces/${this.spaceId}/permissions`,
      { method: "DELETE" },
    );
  }

  list() {
    return this.transport.request<ResourcePermission[]>(
      `/api/spaces/${this.spaceId}/permissions`,
    );
  }

  addCollaborator(granteeUuid: string, level: ResourcePermissionLevel) {
    return this.transport.request<ResourcePermission>(
      `/api/spaces/${this.spaceId}/collaborators`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ granteeUuid, level }),
      },
    );
  }

  listCollaborators() {
    return this.transport.request<ResourcePermission[]>(
      `/api/spaces/${this.spaceId}/collaborators`,
    );
  }

  updateCollaborator(granteeUuid: string, level: ResourcePermissionLevel) {
    return this.transport.request<ResourcePermission>(
      `/api/spaces/${this.spaceId}/collaborators/${granteeUuid}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level }),
      },
    );
  }

  removeCollaborator(granteeUuid: string) {
    return this.transport.request<{ ok: true }>(
      `/api/spaces/${this.spaceId}/collaborators/${granteeUuid}`,
      { method: "DELETE" },
    );
  }
}

class SpaceCheckpointsApi {
  constructor(
    private readonly transport: HttpTransport,
    private readonly spaceId: string,
  ) {}

  create(description?: string | null) {
    return this.transport.request<{ ok: true; taskRunId: string }>(
      `/api/spaces/${this.spaceId}/checkpoints`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: description ?? null }),
      },
    );
  }

  list() {
    return this.transport.request<{ checkpoints: CheckpointRecord[] }>(
      `/api/spaces/${this.spaceId}/checkpoints`,
    );
  }

  get(checkpointId: string, customFetch?: Fetch) {
    return this.transport.request<SpaceCheckpointDetailResponse>(
      `/api/spaces/${this.spaceId}/checkpoints/${checkpointId}`,
      { fetch: customFetch },
    );
  }
}

class SessionPermissionsApi {
  constructor(private readonly transport: HttpTransport) {}

  create(sessionId: string, level: ResourcePermissionLevel) {
    return this.transport.request<ResourcePermission>(
      `/api/sessions/${sessionId}/permissions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level }),
      },
    );
  }

  delete(sessionId: string) {
    return this.transport.request<{ ok: true }>(
      `/api/sessions/${sessionId}/permissions`,
      { method: "DELETE" },
    );
  }
}

class SpaceClient {
  readonly files: SpaceFilesApi;
  readonly sessions: SpaceSessionsApi;
  readonly events: SpaceEventsApi;
  readonly permissions: SpacePermissionsApi;
  readonly checkpoints: SpaceCheckpointsApi;

  constructor(
    readonly id: string,
    private readonly transport: HttpTransport,
    websocketClient: ReturnType<typeof getWebsocketClient>,
  ) {
    this.files = new SpaceFilesApi(transport, id);
    this.sessions = new SpaceSessionsApi(transport, id, websocketClient);
    this.events = new SpaceEventsApi(websocketClient);
    this.permissions = new SpacePermissionsApi(transport, id);
    this.checkpoints = new SpaceCheckpointsApi(transport, id);
  }

  get(customFetch?: Fetch) {
    return this.transport.request<SpaceRecord>(`/api/spaces/${this.id}`, {
      fetch: customFetch,
    });
  }

  rename(name: string) {
    return this.transport.request<{ space: SpaceRecord }>(`/api/spaces/${this.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name }),
    });
  }
}

class ChannelsApi {
  constructor(private readonly transport: HttpTransport) {}

  list(customFetch?: Fetch) {
    return this.transport.request<Channel[]>("/api/channels", {
      method: "GET",
      fetch: customFetch,
    });
  }

  create(data: {
    provider: string;
    name: string;
    credentials: Record<string, unknown>;
  }) {
    return this.transport.request("/api/channels", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
  }

  delete(id: string) {
    return this.transport.request(`/api/channels/${id}`, { method: "DELETE" });
  }
}

class UserApi {
  constructor(
    private readonly transport: HttpTransport,
    private readonly transportBaseUrl: string,
    private readonly setStoredAuthToken?: (token: string) => void,
    private readonly clearStoredAuthToken?: () => void,
  ) {}

  getMe(customFetch?: Fetch) {
    return this.transport.request("/api/me", { fetch: customFetch });
  }

  async setAuthToken(token: string) {
    const trimmedToken = token.trim();
    const response = await fetch(this.transportBaseUrl ? `${this.transportBaseUrl}/api/me` : "/api/me", {
      headers: {
        Authorization: `Bearer ${trimmedToken}`,
      },
    });

    if (!response.ok) {
      const contentType = response.headers.get("content-type") ?? "";
      const message = contentType.includes("application/json")
        ? JSON.stringify(await response.json().catch(() => null))
        : await response.text().catch(() => response.statusText);
      throw new Error(message || response.statusText);
    }

    this.setStoredAuthToken?.(trimmedToken);
    return response.json();
  }

  async clearAuthToken() {
    this.clearStoredAuthToken?.();
    return null;
  }

  getSshKeys(customFetch?: Fetch) {
    return this.transport.request<UserSshKey[]>("/api/user/ssh-keys", {
      method: "GET",
      fetch: customFetch,
    });
  }

  createSshKey(data: { key: string; title: string }) {
    return this.transport.request<UserSshKey>("/api/user/ssh-keys", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
  }

  deleteSshKey(id: string) {
    return this.transport.request<{ ok: true }>(`/api/user/ssh-keys/${id}`, {
      method: "DELETE",
    });
  }
}

class ModelsApi {
  constructor(private readonly fetcher: Fetch, private readonly baseUrl: string) {}

  async list(customFetch?: Fetch) {
    const fetchImpl = customFetch ?? this.fetcher;
    const url = this.baseUrl ? `${this.baseUrl}/api/models` : "/api/models";
    const response = await fetchImpl(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
    }
    return response.json() as Promise<Record<string, ModelCatalogEntry[]>>;
  }
}

class TasksApi {
  constructor(private readonly transport: HttpTransport) {}

  get(taskRunId: string) {
    return this.transport.request<{ run: TaskRunRecord }>(`/api/tasks/${taskRunId}`);
  }

  list(filters?: { cronJobId?: string; spaceId?: string }) {
    const params = new URLSearchParams();
    if (filters?.cronJobId) params.set("cronJobId", filters.cronJobId);
    if (filters?.spaceId) params.set("spaceId", filters.spaceId);
    const query = params.toString();
    return this.transport.request<{ runs: TaskRunRecord[] }>(
      `/api/tasks${query ? `?${query}` : ""}`,
    );
  }

  createScheduled(data: CreateScheduledTaskInput) {
    return this.transport.request<{ ok: true; taskRunId: string; scheduledAt: string }>(
      "/api/tasks",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    );
  }
}

class CronJobsApi {
  constructor(private readonly transport: HttpTransport) {}

  list(spaceId?: string) {
    const query = spaceId ? `?spaceId=${encodeURIComponent(spaceId)}` : "";
    return this.transport.request<{ jobs: CronJobRecord[] }>(`/api/cron-jobs${query}`);
  }

  create(data: CreateCronJobInput) {
    return this.transport.request<CronJobRecord>("/api/cron-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  }

  delete(id: string) {
    return this.transport.request<{ ok: true }>(`/api/cron-jobs/${id}`, {
      method: "DELETE",
    });
  }

  toggle(id: string, enabled: boolean) {
    return this.transport.request<{ ok: true }>(`/api/cron-jobs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
  }

  runs(cronJobId: string) {
    return this.transport.request<{ runs: TaskRunRecord[] }>(
      `/api/cron-jobs/${cronJobId}/runs`,
    );
  }
}

export class CohubClient {
  readonly spaces: SpacesApi;
  readonly channels: ChannelsApi;
  readonly user: UserApi;
  readonly models: ModelsApi;
  readonly sessionPermissions: SessionPermissionsApi;
  readonly tasks: TasksApi;
  readonly cronJobs: CronJobsApi;

  private readonly transport: HttpTransport;
  private readonly websocketClient: ReturnType<typeof getWebsocketClient>;

  constructor(options: CohubClientOptions = {}) {
    this.transport = new HttpTransport(options);
    this.websocketClient = getWebsocketClient({
      ...options.websocket,
      getAccessToken: options.getAccessToken,
    });
    this.spaces = new SpacesApi(this.transport);
    this.channels = new ChannelsApi(this.transport);
    this.user = new UserApi(
      this.transport,
      options.baseUrl ?? "",
      options.setStoredAuthToken,
      options.clearStoredAuthToken,
    );
    this.models = new ModelsApi(options.fetch ?? fetch, options.baseUrl ?? "");
    this.sessionPermissions = new SessionPermissionsApi(this.transport);
    this.tasks = new TasksApi(this.transport);
    this.cronJobs = new CronJobsApi(this.transport);
  }

  space(spaceId: string) {
    return new SpaceClient(spaceId, this.transport, this.websocketClient);
  }

}

export const createCohubClient = (options?: CohubClientOptions) =>
  new CohubClient(options);

export function extractSessionRenderState(content: ContentBlock[]) {
  const thinkingBlocks = content.filter(
    (block): block is Extract<ContentBlock, { type: "thinking" }> =>
      block.type === "thinking",
  );
  const textBlocks = content.filter(
    (block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text",
  );
  const toolUseBlocks = content.filter(
    (block): block is Extract<ContentBlock, { type: "tool_use" }> =>
      block.type === "tool_use",
  );

  const thinking = thinkingBlocks
    .map((block) => block.thinking)
    .join("\n")
    .trim();
  const answer = textBlocks
    .map((block) => block.text)
    .join("\n")
    .trim();
  const toolCalls = toolUseBlocks.map((block) => ({
    toolCallId: block.id,
    toolName: block.name,
    status:
      (block._meta as { toolStatus?: string } | undefined)?.toolStatus ?? "queued",
    summary: (block._meta as { summary?: string } | undefined)?.summary ?? "",
  }));

  return { thinking, answer, toolCalls };
}
