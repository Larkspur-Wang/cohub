import { goto } from "$app/navigation";
import { PUBLIC_API_ORIGIN, PUBLIC_GATEWAY_ORIGIN } from "$env/static/public";
import {
  clearAuthToken as clearStoredAuthToken,
  getAuthToken,
  logtoClient,
  setAuthToken as setStoredAuthToken,
} from "$lib/auth";

const API_BASE_URL = PUBLIC_API_ORIGIN ?? "";
const GATEWAY_BASE_URL = PUBLIC_GATEWAY_ORIGIN ?? "";

type ApiError = {
  message: string;
};

type Fetch = typeof globalThis.fetch;

export type SessionBindingRecord = {
  id: string;
  runtimeId: string;
  runtimeSessionId: string;
  runtimeChannelId: string;
  provider: string;
  bindingKey: string;
  externalChatId: string;
  status: string | null;
  meta?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt?: string | null;
};

export type SessionRecord = {
  id: string;
  runtimeId: string;
  title: string | null;
  source: string | null;
  status: string | null;
  cwd: string | null;
  protocol: string | null;
  externalSessionId?: string | null;
  meta?: Record<string, unknown> | null;
  bindings?: SessionBindingRecord[];
  parentSessionId?: string | null;
  forkedFromMessageId?: string | null;
  lineageRootSessionId?: string | null;
  forkDepth?: number;
  latestMessageText?: string | null;
  lastMessageAt?: string | null;
  lastMessageId?: string | null;
  totalMessages?: number;
  totalToolCalls?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalCost?: string | number | null;
  createdAt: string;
  updatedAt: string;
};

export type SessionMessageBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "image"; source: { type: "url"; url: string } | { type: "base64"; media_type: string; data: string } }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: string | SessionMessageBlock[];
      is_error?: boolean;
    }
  | {
      type: "system_note";
      note_type: "session_created" | "forked" | "compacted" | "info";
      text: string;
    };

export type SessionMessageRecord = {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: SessionMessageBlock[];
  text: string | null;
  sequence: number;
  provider: string | null;
  model: string | null;
  stopReason: string | null;
  errorMessage: string | null;
  usageInput: number | null;
  usageOutput: number | null;
  costTotal: string | null;
  createdAt: string;
};

export type SessionMessagesResponse = {
  runtime: RuntimeRecord;
  session: SessionRecord;
  messages: SessionMessageRecord[];
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

const gatewayFetch = async (
  path: string,
  init?: RequestInit & { fetch?: Fetch },
) => {
  const fetcher = init?.fetch ?? fetch;
  const url = GATEWAY_BASE_URL ? `${GATEWAY_BASE_URL}${path}` : path;

  const response = await fetcher(url, await withAuthorization(init));

  if (response.status === 401 && typeof window !== "undefined") {
    await logtoClient.signIn(`${window.location.origin}/`);
    throw new Error("unauthorized");
  }

  return response;
};

const readSseEvents = async function* (response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = "";

  const extractNextChunk = () => {
    const lfBoundary = buffer.indexOf("\n\n");
    const crlfBoundary = buffer.indexOf("\r\n\r\n");

    if (lfBoundary === -1 && crlfBoundary === -1) {
      return null;
    }

    if (
      crlfBoundary !== -1 &&
      (lfBoundary === -1 || crlfBoundary < lfBoundary)
    ) {
      const chunk = buffer.slice(0, crlfBoundary);
      buffer = buffer.slice(crlfBoundary + 4);
      return chunk;
    }

    const chunk = buffer.slice(0, lfBoundary);
    buffer = buffer.slice(lfBoundary + 2);
    return chunk;
  };

  const parseChunk = (chunk: string) => {
    const normalizedChunk = chunk.replace(/\r\n/g, "\n");
    const dataLines = normalizedChunk
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""));

    return dataLines.join("\n");
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let chunk = extractNextChunk();
    while (chunk !== null) {
      const data = parseChunk(chunk);
      if (data) {
        yield data;
      }
      chunk = extractNextChunk();
    }
  }

  buffer += decoder.decode();
  const trailingData = parseChunk(buffer);
  if (trailingData) {
    yield trailingData;
  }
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

export const getWorkspaceById = async (id: string, customFetch?: Fetch) => {
  return apiFetch(`/api/workspaces/${id}`, {
    fetch: customFetch,
  }) as Promise<WorkspaceByIdResponse>;
};

export const getWorkspaceTree = async (
  id: string,
  path = "",
  ref?: string,
  customFetch?: Fetch,
) => {
  const params = new URLSearchParams();
  if (path) {
    params.set("path", path);
  }
  if (ref) {
    params.set("ref", ref);
  }
  const query = params.toString();
  return apiFetch(`/api/workspaces/${id}/tree${query ? `?${query}` : ""}`, {
    fetch: customFetch,
  }) as Promise<Tree>;
};

export const getWorkspaceFile = async (
  id: string,
  path: string,
  ref?: string,
  customFetch?: Fetch,
) => {
  const params = new URLSearchParams({ path });
  if (ref) {
    params.set("ref", ref);
  }
  return apiFetch(`/api/workspaces/${id}/file?${params.toString()}`, {
    fetch: customFetch,
  });
};

export const getSession = async (id: string, customFetch?: Fetch) => {
  return apiFetch(`/api/sessions/${id}`, {
    fetch: customFetch,
  }) as Promise<{ runtime: RuntimeRecord; session: SessionRecord }>;
};

export const getSessionMessages = async (id: string, customFetch?: Fetch) => {
  return apiFetch(`/api/sessions/${id}/messages`, {
    fetch: customFetch,
  }) as Promise<SessionMessagesResponse>;
};

export type SessionResponseStreamEvent =
  | {
      type: "response.created";
      response: { id: string; status: string; model: string };
    }
  | {
      type: "response.output_text.content";
      content: string;
      timestamp: number;
    }
  | {
      type: "response.completed";
      response: {
        id: string;
        status: string;
        model: string;
        output?: Array<{
          content?: Array<{
            text?: string;
          }>;
        }>;
      };
    }
  | {
      type: "response.failed";
      response: { error?: { message?: string; type?: string } };
    };

export const postSessionMessage = async (sessionId: string, content: SessionMessageBlock[]) => {
  return apiFetch(`/api/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content }),
  }) as Promise<{ ok: true; userMessage: SessionMessageRecord }>;
};

export const forkSession = async (
  id: string,
  input: { fromMessageId: string; title?: string | null },
) => {
  return apiFetch(`/api/sessions/${id}/fork`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  }) as Promise<{ ok: true; session: SessionRecord }>;
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
  boundRuntime: {
    id: string;
    title: string | null;
    status: string;
  } | null;
};

export type WorkspaceListItem = {
  id: string;
  userUuid: string;
  ownerUserUuid: string;
  name: string;
  description: string | null;
  giteaRepoName: string;
  visibility: "public" | "private";
  parentId?: string | null;
  forkCount?: number;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceForkInfo = {
  id: string;
  name: string;
  ownerUserUuid: string;
  ownerUsername: string | null;
};

export type WorkspaceDetail = WorkspaceListItem & {
  ownerUsername: string | null;
  cloneUrl: string | null;
  sshUrl: string | null;
  htmlUrl: string | null;
  fullName: string | null;
  forkedFrom: WorkspaceForkInfo | null;
  isOwner: boolean;
};

export type Workspace = WorkspaceListItem;

export type PublicWorkspace = WorkspaceListItem & {
  forkCount: number;
  parentId: string | null;
};

export type TreeEntry = {
  name: string;
  path: string;
  type: "dir" | "file";
  size?: number;
};

export type Tree = {
  repoOwner: string;
  repoName: string;
  path: string;
  ref: string | null;
  entries: TreeEntry[];
};

export type GiteaRepo = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  clone_url: string;
  ssh_url: string;
  html_url: string;
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

export const getWorkspaces = async (customFetch?: Fetch) => {
  return apiFetch("/api/workspaces", {
    method: "GET",
    fetch: customFetch,
  }) as Promise<WorkspaceListItem[]>;
};

export const createWorkspace = async (data: {
  name: string;
  description?: string;
  private?: boolean;
}) => {
  return apiFetch("/api/workspaces", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  }) as Promise<WorkspaceDetail>;
};

export type RuntimeProvisionStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed";
export type RuntimeProvisionLevel = "info" | "success" | "error";
export type RuntimeProvisionStep =
  | "queued"
  | "init_git_account"
  | "prepare_workspace"
  | "create_pod"
  | "bind_channels"
  | "wait_runtime_running"
  | "completed";

export type RuntimeProvisionEvent = {
  id: string;
  at: string;
  level: RuntimeProvisionLevel;
  status: RuntimeProvisionStatus;
  step: RuntimeProvisionStep;
  message: string;
  meta?: Record<string, unknown> | null;
};

export type RuntimeProvisionResponse = {
  runtimeId: string;
  status: RuntimeProvisionStatus;
  currentStep: RuntimeProvisionStep;
  currentMessage: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string | null;
  events: RuntimeProvisionEvent[];
};

export type RuntimeRecord = {
  id: string;
  userUuid: string;
  workspaceId: string | null;
  workspaceCommitHash: string | null;
  agentId: string | null;
  agentCommitHash: string | null;
  title: string | null;
  status: string | null;
  liveStatus?: string | null;
  meta?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  channels?: {
    id: string;
    name: string | null;
    provider: string;
    status: string;
  }[];
};

export type RuntimeListItem = RuntimeRecord;

export type RuntimeCreateResponse = {
  runtime: RuntimeRecord;
  session: SessionRecord;
  ready: boolean;
};

export type RuntimeEnvInput = {
  name: string;
  value: string;
};

export type RuntimeChannelConfigInput = {
  inbound?: {
    requireMentionInGuild?: boolean;
  };
  outbound?: {
    showThinking?: boolean;
    showToolCalls?: boolean;
  };
};

export type RuntimeChannelBindingInput = {
  channelId: string;
  config?: RuntimeChannelConfigInput | null;
};

export type RuntimeChannelRecord = {
  id: string;
  runtimeId: string;
  channelId: string;
  config?: RuntimeChannelConfigInput | null;
  createdAt: string;
  channel?: Channel | null;
};

export type RuntimeSessionsResponse = {
  runtime: RuntimeRecord;
  sessions: SessionRecord[];
};

export const createRuntime = async (input?: {
  workspaceId?: string;
  agentId?: string;
  title?: string;
  source?: string;
  cwd?: string;
  protocol?: "pi" | "acp" | "internal";
  start?: boolean;
  extraEnv?: RuntimeEnvInput[];
  channelBindings?: RuntimeChannelBindingInput[];
}) => {
  return apiFetch("/api/runtimes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input ?? {}),
  }) as Promise<RuntimeCreateResponse>;
};

export const getRuntimes = async (customFetch?: Fetch) => {
  return apiFetch("/api/runtimes", {
    method: "GET",
    fetch: customFetch,
  }) as Promise<RuntimeListItem[]>;
};

export const getRuntime = async (id: string, customFetch?: Fetch) => {
  return apiFetch(`/api/runtimes/${id}`, {
    fetch: customFetch,
  }) as Promise<RuntimeRecord>;
};

export const getRuntimeProvisioning = async (
  id: string,
  customFetch?: Fetch,
) => {
  return apiFetch(`/api/runtimes/${id}/provisioning`, {
    fetch: customFetch,
  }) as Promise<RuntimeProvisionResponse>;
};

export const createRuntimeSession = async (
  id: string,
  input?: {
    title?: string;
    source?: string;
    cwd?: string;
    protocol?: "pi" | "acp" | "internal";
  },
) => {
  return apiFetch(`/api/runtimes/${id}/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input ?? {}),
  }) as Promise<{ ok: true; session: SessionRecord }>;
};

export const getRuntimeSessions = async (id: string, customFetch?: Fetch) => {
  return apiFetch(`/api/runtimes/${id}/sessions`, {
    fetch: customFetch,
  }) as Promise<RuntimeSessionsResponse>;
};

export const getRuntimeChannels = async (id: string, customFetch?: Fetch) => {
  return apiFetch(`/api/runtimes/${id}/channels`, {
    fetch: customFetch,
  }) as Promise<RuntimeChannelRecord[]>;
};

export const updateRuntimeChannelConfig = async (
  id: string,
  input: { config: RuntimeChannelConfigInput | null },
) => {
  return apiFetch(`/api/runtime-channels/${id}/config`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  }) as Promise<RuntimeChannelRecord>;
};

export const getRuntimeSessionGraph = async (
  id: string,
  customFetch?: Fetch,
) => {
  return apiFetch(`/api/runtimes/${id}/session-graph`, {
    fetch: customFetch,
  }) as Promise<RuntimeSessionsResponse>;
};

export type PublicWorkspacesResponse = {
  items: PublicWorkspace[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export const getPublicWorkspaces = async (
  page = 1,
  limit = 20,
  search?: string,
  customFetch?: Fetch,
) => {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("limit", String(limit));
  if (search) {
    params.set("search", search);
  }
  return apiFetch(`/api/workspaces/public?${params.toString()}`, {
    fetch: customFetch,
  }) as Promise<PublicWorkspacesResponse>;
};

export type ForkWorkspaceResponse = WorkspaceDetail & {
  forkedFrom: WorkspaceForkInfo;
};

export const forkWorkspace = async (id: string, name?: string) => {
  return apiFetch(`/api/workspaces/${id}/fork`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(name ? { name } : {}),
  }) as Promise<ForkWorkspaceResponse>;
};

export type WorkspaceByIdResponse = WorkspaceDetail;

export const updateWorkspace = async (
  id: string,
  data: {
    name?: string;
    description?: string;
    visibility?: "public" | "private";
  },
) => {
  return apiFetch(`/api/workspaces/${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  }) as Promise<WorkspaceDetail>;
};

export const deleteWorkspace = async (id: string) => {
  return apiFetch(`/api/workspaces/${id}`, {
    method: "DELETE",
  }) as Promise<null>;
};

export const hibernateRuntime = async (id: string) => {
  return apiFetch(`/api/runtimes/${id}/hibernate`, {
    method: "POST",
  }) as Promise<{ runtime: RuntimeRecord }>;
};

export const wakeRuntime = async (id: string) => {
  return apiFetch(`/api/runtimes/${id}/wake`, {
    method: "POST",
  }) as Promise<{ runtime: RuntimeRecord }>;
};

export const deleteRuntime = async (id: string) => {
  return apiFetch(`/api/runtimes/${id}`, {
    method: "DELETE",
  }) as Promise<{ success: boolean }>;
};

// ─── SSH Key Management ──────────────────────────────

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

// ─── SSE Streaming ──────────────────────────────

export type ProviderRenderUpdateEvent = {
  type: "provider_render_update";
  runtimeId: string;
  sessionId: string;
  renderMode: string;
  thinking: string | null;
  toolCalls: Array<{
    toolCallId: string;
    toolName: string;
    status: string;
    summary?: string;
  }> | null;
  answer: string | null;
  sourceMessageId: string | null;
  timestamp: number;
  turnEnd?: boolean;
  anchorUserMessageId?: string | null;
};

export type RuntimeStreamEvent = ProviderRenderUpdateEvent;

export const streamRuntimeEvents = async function* (
  runtimeId: string,
  lastEventId?: string,
  signal?: AbortSignal,
) {
  const url = API_BASE_URL
    ? `${API_BASE_URL}/api/runtimes/${runtimeId}/stream`
    : `/api/runtimes/${runtimeId}/stream`;

  const headers = new Headers();
  const token = await getAuthToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (lastEventId) {
    headers.set("Last-Event-ID", lastEventId);
  }

  const response = await fetch(url, {
    headers,
    signal,
  });

  if (!response.ok) {
    throw new Error(`Stream request failed: ${response.status} ${response.statusText}`);
  }

  for await (const data of readSseEvents(response)) {
    try {
      yield JSON.parse(data) as RuntimeStreamEvent;
    } catch {
      // Skip non-JSON events (e.g. "ready" event)
    }
  }
};

export const streamSessionEvents = async function* (
  sessionId: string,
  lastEventId?: string,
  signal?: AbortSignal,
) {
  const url = API_BASE_URL
    ? `${API_BASE_URL}/api/sessions/${sessionId}/stream`
    : `/api/sessions/${sessionId}/stream`;

  const headers = new Headers();
  const token = await getAuthToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (lastEventId) {
    headers.set("Last-Event-ID", lastEventId);
  }

  const response = await fetch(url, {
    headers,
    signal,
  });

  if (!response.ok) {
    throw new Error(`Stream request failed: ${response.status} ${response.statusText}`);
  }

  for await (const data of readSseEvents(response)) {
    try {
      yield JSON.parse(data) as RuntimeStreamEvent;
    } catch {
      // Skip non-JSON events (e.g. "ready" event)
    }
  }
};
