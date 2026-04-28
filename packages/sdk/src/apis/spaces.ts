import { ensureRealtimeConnected } from "../realtime.js";
import type { WebsocketClient, WebsocketEventPayload } from "../websocket.js";
import type { HttpTransport, Fetch } from "../transport.js";
import type {
  CheckpointRecord,
  ContentBlock,
  SessionMessageResponse,
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
  SpaceFsUploadResponse,
  SpaceUsageResponse,
  SpaceFsWriteFileInput,
  SpaceMember,
  SpaceRecord,
  SpaceRole,
  SpaceSessionsResponse,
} from "../types.js";
import { SpaceInvitationsApi } from "./invitations.js";

const DEFAULT_DEDUP_WINDOW_MS = 2000;

export type SessionSubscriptionHandlers = {
  progress?: (event: WebsocketEventPayload) => void;
  final?: (event: WebsocketEventPayload) => void;
  error?: (event: WebsocketEventPayload) => void;
  persisted?: (event: WebsocketEventPayload) => void;
  event?: (event: WebsocketEventPayload) => void;
};

export type SessionEventName = "turn.progress" | "turn.final" | "turn.error" | "message.persisted";
export type SpaceEventName = SessionEventName | "event";

type SessionSendMessageInput = {
  content: ContentBlock[];
  model?: string;
  provider?: string;
  clientMessageId?: string;
};

const toSessionEventName = (type: WebsocketEventPayload["type"]): SessionEventName | null => {
  switch (type) {
    case "session.turn.progress":
      return "turn.progress";
    case "session.turn.final":
      return "turn.final";
    case "session.turn.error":
      return "turn.error";
    case "session.message.persisted":
      return "message.persisted";
    default:
      return null;
  }
};

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

  upload(files: File[], dir = "") {
    const params = new URLSearchParams();
    if (dir) params.set("dir", dir);
    const query = params.toString();
    const formData = new FormData();
    for (const file of files) formData.append("files", file);
    return this.transport.request<SpaceFsUploadResponse>(
      `/api/spaces/${this.spaceId}/fs/upload${query ? `?${query}` : ""}`,
      {
        method: "POST",
        body: formData,
      },
    );
  }
}

class SessionMessagesClient {
  private lastSentSignature = "";
  private lastSentSessionId = "";
  private lastSentAt = 0;

  constructor(
    private readonly transport: HttpTransport,
    private readonly sessionId: string,
  ) {}

  list(customFetch?: Fetch) {
    return this.transport.request<SessionMessagesResponse>(
      `/api/sessions/${this.sessionId}/messages`,
      {
        fetch: customFetch,
      },
    );
  }

  get(
    messageId: string,
    optionsOrFetch?: { detail?: "summary" | "full" } | Fetch,
    customFetch?: Fetch,
  ) {
    const options = typeof optionsOrFetch === "function" ? undefined : optionsOrFetch;
    const fetch = typeof optionsOrFetch === "function" ? optionsOrFetch : customFetch;
    const params = new URLSearchParams();
    if (options?.detail) params.set("detail", options.detail);
    const query = params.toString();
    return this.transport.request<SessionMessageResponse>(
      `/api/sessions/${this.sessionId}/messages/${messageId}${query ? `?${query}` : ""}`,
      {
        fetch,
      },
    );
  }

  listPaginated(
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
      `/api/sessions/${this.sessionId}/messages${query ? `?${query}` : ""}`,
      {
        fetch: customFetch,
      },
    );
  }

  async send(input: SessionSendMessageInput) {
    const signature = JSON.stringify({ sessionId: this.sessionId, input });
    const now = Date.now();
    if (
      this.sessionId === this.lastSentSessionId &&
      signature === this.lastSentSignature &&
      now - this.lastSentAt < DEFAULT_DEDUP_WINDOW_MS
    ) {
      throw new Error("Duplicate message ignored");
    }
    this.lastSentSessionId = this.sessionId;
    this.lastSentSignature = signature;
    this.lastSentAt = now;

    return this.transport.request<{ ok: true; userMessageId: string }>(
      `/api/sessions/${this.sessionId}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: input.content,
          model: input.model,
          provider: input.provider,
          clientMessageId: input.clientMessageId,
        }),
      },
    );
  }
}

class SessionRealtimeClient {
  constructor(
    private readonly websocketClient: WebsocketClient | null,
    private readonly spaceId: string,
    private readonly sessionId: string,
  ) {}

  subscribe(handlers: SessionSubscriptionHandlers) {
    if (!this.websocketClient) {
      throw new Error("realtime transport is not configured for this client");
    }
    ensureRealtimeConnected(this.websocketClient);
    const unsubscribe = this.websocketClient.on("event", (event) => {
      if (event.spaceId !== this.spaceId || event.sessionId !== this.sessionId) return;
      handlers.event?.(event);
      const eventName = toSessionEventName(event.type);
      if (eventName === "turn.progress") handlers.progress?.(event);
      if (eventName === "turn.final") handlers.final?.(event);
      if (eventName === "turn.error") handlers.error?.(event);
      if (eventName === "message.persisted") handlers.persisted?.(event);
    });
    return () => unsubscribe();
  }

  on(type: SessionEventName, handler: (event: WebsocketEventPayload) => void) {
    return this.subscribe({
      event: (event) => {
        if (toSessionEventName(event.type) === type) handler(event);
      },
    });
  }
}

export class SessionClient {
  readonly messages: SessionMessagesClient;
  readonly realtime: SessionRealtimeClient;

  constructor(
    readonly spaceId: string,
    readonly id: string,
    private readonly transport: HttpTransport,
    websocketClient: WebsocketClient | null,
  ) {
    this.messages = new SessionMessagesClient(transport, id);
    this.realtime = new SessionRealtimeClient(websocketClient, spaceId, id);
  }

  get(customFetch?: Fetch) {
    return this.transport.request<{ space: SpaceRecord; session: SessionRecord }>(
      `/api/sessions/${this.id}`,
      {
        fetch: customFetch,
      },
    );
  }

  rename(title: string | null, customFetch?: Fetch) {
    return this.transport.request<{ session: SessionRecord }>(
      `/api/sessions/${this.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ title }),
        fetch: customFetch,
      },
    );
  }

  subscribe(handlers: SessionSubscriptionHandlers) {
    return this.realtime.subscribe(handlers);
  }

  on(type: SessionEventName, handler: (event: WebsocketEventPayload) => void) {
    return this.realtime.on(type, handler);
  }
}

export class SpaceSessionsApi {
  constructor(
    private readonly transport: HttpTransport,
    private readonly spaceId: string,
    private readonly websocketClient: WebsocketClient | null,
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

  byId(sessionId: string) {
    return new SessionClient(this.spaceId, sessionId, this.transport, this.websocketClient);
  }
}

export type WebSocketConnectionState = {
  state: "connecting" | "reconnecting" | "open" | "closed" | "error";
  willReconnect: boolean;
  connectionId?: string | null;
  attempt?: number;
  delayMs?: number;
  recoverable?: boolean;
};

export class SpaceEventsApi {
  constructor(
    private readonly websocketClient: WebsocketClient | null,
    private readonly spaceId: string,
  ) {}

  subscribe(handler: (event: WebsocketEventPayload) => void) {
    if (!this.websocketClient) {
      throw new Error("realtime transport is not configured for this client");
    }
    ensureRealtimeConnected(this.websocketClient);
    return this.websocketClient.on("event", (event) => {
      if (event.spaceId !== this.spaceId) return;
      handler(event);
    });
  }

  on(type: SpaceEventName, handler: (event: WebsocketEventPayload) => void) {
    return this.subscribe((event) => {
      if (type === "event") {
        handler(event);
        return;
      }
      if (toSessionEventName(event.type) === type) handler(event);
    });
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
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
  }
}

export class SpaceUsageApi {
  constructor(
    private readonly transport: HttpTransport,
    private readonly spaceId: string,
  ) {}

  get(days = 30, customFetch?: Fetch) {
    const params = new URLSearchParams({ days: String(days) });
    return this.transport.request<SpaceUsageResponse>(
      `/api/spaces/${this.spaceId}/usage?${params.toString()}`,
      { fetch: customFetch },
    );
  }
}

export type SpaceChannelBindingRecord = {
  id: string;
  spaceId: string;
  channelId: string;
  config: Record<string, unknown> | null;
  createdAt: string;
  channel: {
    id: string;
    userUuid: string;
    provider: string;
    name: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  } | null;
};

export class SpaceChannelsApi {

  constructor(
    private readonly transport: HttpTransport,
    private readonly spaceId: string,
  ) {}

  list() {
    return this.transport.request<SpaceChannelBindingRecord[]>(
      `/api/spaces/${this.spaceId}/channels`,
    );
  }

  bind(channelId: string, config?: Record<string, unknown> | null) {
    return this.transport.request<SpaceChannelBindingRecord>(
      `/api/spaces/${this.spaceId}/channels/${channelId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: config ?? null }),
      },
    );
  }

  unbind(channelId: string) {
    return this.transport.request<{ ok: true }>(
      `/api/spaces/${this.spaceId}/channels/${channelId}`,
      { method: "DELETE" },
    );
  }
}

export class SpaceEnvApi {
  constructor(
    private readonly transport: HttpTransport,
    private readonly spaceId: string,
  ) {}

  list() {
    return this.transport.request<{ env: SpaceEnvInput[] }>(
      `/api/spaces/${this.spaceId}/env`,
    );
  }

  create(input: SpaceEnvInput) {
    return this.transport.request<{ env: SpaceEnvInput[] }>(
      `/api/spaces/${this.spaceId}/env`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  }

  update(name: string, value: string) {
    return this.transport.request<{ env: SpaceEnvInput[] }>(
      `/api/spaces/${this.spaceId}/env/${encodeURIComponent(name)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      },
    );
  }

  remove(name: string) {
    return this.transport.request<{ env: SpaceEnvInput[] }>(
      `/api/spaces/${this.spaceId}/env/${encodeURIComponent(name)}`,
      { method: "DELETE" },
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
  readonly members: SpaceMembersApi;
  readonly access: SpaceAccessApi;
  readonly checkpoints: SpaceCheckpointsApi;
  readonly usage: SpaceUsageApi;
  readonly channels: SpaceChannelsApi;
  readonly env: SpaceEnvApi;
  readonly invitations: SpaceInvitationsApi;

  constructor(
    readonly id: string,
    private readonly transport: HttpTransport,
    private readonly websocketClient: WebsocketClient | null,
  ) {
    this.files = new SpaceFilesApi(transport, id);
    this.sessions = new SpaceSessionsApi(transport, id, websocketClient);
    this.members = new SpaceMembersApi(transport, id);
    this.access = new SpaceAccessApi(transport, id);
    this.checkpoints = new SpaceCheckpointsApi(transport, id);
    this.usage = new SpaceUsageApi(transport, id);
    this.channels = new SpaceChannelsApi(transport, id);
    this.env = new SpaceEnvApi(transport, id);
    this.invitations = new SpaceInvitationsApi(transport, id);
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

  session(sessionId: string) {
    return new SessionClient(this.id, sessionId, this.transport, this.websocketClient);
  }

  subscribe(handler: (event: WebsocketEventPayload) => void) {
    return new SpaceEventsApi(this.websocketClient, this.id).subscribe(handler);
  }

  on(type: SpaceEventName, handler: (event: WebsocketEventPayload) => void) {
    return new SpaceEventsApi(this.websocketClient, this.id).on(type, handler);
  }
}
