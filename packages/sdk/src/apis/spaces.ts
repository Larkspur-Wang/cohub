import { ensureRealtimeConnected } from "../realtime.js";
import type { getWebsocketClient } from "../websocket.js";
import type { HttpTransport, Fetch } from "../transport.js";
import type {
  CheckpointRecord,
  ContentBlock,
  SessionMessagesPaginatedResponse,
  SessionMessagesResponse,
  SessionRecord,
  SpaceAccessPolicy,
  SpaceBootstrapSource,
  SpaceChannelBindingInput,
  SpaceCheckpointDetailResponse,
  SpaceCreateResponse,
  SpaceEnvInput,
  SpaceFsFileResponse,
  SpaceFsMoveInput,
  SpaceFsTreeResponse,
  SpaceFsWriteFileInput,
  SpaceMember,
  SpaceRecord,
  SpaceRole,
  SpaceSessionsResponse,
} from "../types.js";

const DEFAULT_DEDUP_WINDOW_MS = 2000;

export class SpacesApi {
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

export class SpaceFilesApi {
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

export class SpaceSessionsApi {
  private lastSentSignature = "";
  private lastSentSessionId = "";
  private lastSentAt = 0;

  constructor(
    private readonly transport: HttpTransport,
    private readonly spaceId: string,
    private readonly websocketClient: ReturnType<typeof getWebsocketClient>,
  ) {}

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
    ensureRealtimeConnected(this.websocketClient);
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

export class SpaceEventsApi {
  constructor(private readonly websocketClient: ReturnType<typeof getWebsocketClient>) {}

  onEvent(handler: (event: unknown) => void) {
    ensureRealtimeConnected(this.websocketClient);
    return this.websocketClient.on("event", handler);
  }
}

export class SpaceMembersApi {
  constructor(
    private readonly transport: HttpTransport,
    private readonly spaceId: string,
  ) {}

  list() {
    return this.transport.request<{ items: SpaceMember[] }>(
      `/api/spaces/${this.spaceId}/members`,
    );
  }

  update(userId: string, role: SpaceRole) {
    return this.transport.request<SpaceMember>(
      `/api/spaces/${this.spaceId}/members`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role }),
      },
    );
  }

  remove(userId: string) {
    return this.transport.request<{ ok: true }>(
      `/api/spaces/${this.spaceId}/members`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      },
    );
  }
}

export class SpaceAccessApi {
  constructor(
    private readonly transport: HttpTransport,
    private readonly spaceId: string,
  ) {}

  get() {
    return this.transport.request<SpaceAccessPolicy>(
      `/api/spaces/${this.spaceId}/access`,
    );
  }

  set(body: { signed_in_user?: SpaceRole | null; anonymous_user?: SpaceRole | null }) {
    return this.transport.request<SpaceAccessPolicy>(
      `/api/spaces/${this.spaceId}/access`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
  }
}

export class SpaceCheckpointsApi {
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

export class SpaceClient {
  readonly files: SpaceFilesApi;
  readonly sessions: SpaceSessionsApi;
  readonly events: SpaceEventsApi;
  readonly members: SpaceMembersApi;
  readonly access: SpaceAccessApi;
  readonly checkpoints: SpaceCheckpointsApi;

  constructor(
    readonly id: string,
    private readonly transport: HttpTransport,
    websocketClient: ReturnType<typeof getWebsocketClient>,
  ) {
    this.files = new SpaceFilesApi(transport, id);
    this.sessions = new SpaceSessionsApi(transport, id, websocketClient);
    this.events = new SpaceEventsApi(websocketClient);
    this.members = new SpaceMembersApi(transport, id);
    this.access = new SpaceAccessApi(transport, id);
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
