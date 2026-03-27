import { goto } from "$app/navigation";
import { PUBLIC_API_ORIGIN } from "$env/static/public";

const API_BASE_URL = PUBLIC_API_ORIGIN ?? "";

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
  | { type: "image"; url: string; mimeType?: string }
  | {
      type: "tool_call";
      toolCallId: string;
      toolName: string;
      args?: Record<string, unknown>;
      resultPreview?: string | null;
      isError?: boolean;
    }
  | {
      type: "system_note";
      noteType: "compaction" | "info";
      text: string;
    };

export type SessionMessageRecord = {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: SessionMessageBlock[];
  text: string | null;
  externalMessageId?: string | null;
  protocolMessageId?: string | null;
  sequence: number;
  prevMessageId: string | null;
  provider: string | null;
  model: string | null;
  stopReason: string | null;
  errorMessage: string | null;
  usageInput: number | null;
  usageOutput: number | null;
  usageTotalTokens: number | null;
  costTotal: string | null;
  createdAt: string;
};

export type SessionToolCallRecord = {
  id: string;
  sessionId: string;
  messageId: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown> | null;
  result: unknown;
  resultPreview: string | null;
  isError: boolean;
  createdAt: string;
};

export type SessionMessagesResponse = {
  runtime: RuntimeRecord;
  session: SessionRecord;
  messages: SessionMessageRecord[];
  toolCalls: SessionToolCallRecord[];
};

type SessionStreamEvent = {
  type: string;
  [key: string]: unknown;
};

const apiFetch = async (
  path: string,
  init?: RequestInit & { fetch?: Fetch },
) => {
  const fetcher = init?.fetch ?? fetch;
  const url = API_BASE_URL ? `${API_BASE_URL}${path}` : path;

  const response = await fetcher(url, {
    credentials: "include",
    ...init,
  });

  if (response.status === 401 && typeof window !== "undefined") {
    await goto("/login");
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
  return apiFetch("/api/auth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token }),
  });
};

export const clearAuthToken = async () => {
  return apiFetch("/api/auth/token", {
    method: "DELETE",
  });
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

export const sendSessionMessage = async (
  id: string,
  input: {
    text: string;
    images?: Array<{ url: string }>;
  },
) => {
  return apiFetch(`/api/sessions/${id}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
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


export type {
  ApiError,
  SessionStreamEvent,
};

export type Channel = {
  id: string;
  userUuid: string;
  provider: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
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
  return apiFetch("/api/channels", { method: "GET", fetch: customFetch }) as Promise<Channel[]>;
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
  return apiFetch("/api/workspaces", { method: "GET", fetch: customFetch }) as Promise<WorkspaceListItem[]>;
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

export type RuntimeProvisionStatus = "queued" | "running" | "succeeded" | "failed";
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

export type RuntimeChannelBindingInput = {
  channelId: string;
  config?: Record<string, unknown> | null;
};

export type RuntimeSessionsResponse = {
  runtime: RuntimeRecord;
  sessions: SessionRecord[];
};

export const createRuntime = async (input?: {
  workspaceId?: string;
  agentId?: string;
  title?: string;
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

export const getRuntimeProvisioning = async (id: string, customFetch?: Fetch) => {
  return apiFetch(`/api/runtimes/${id}/provisioning`, {
    fetch: customFetch,
  }) as Promise<RuntimeProvisionResponse>;
};

export const getRuntimeSessions = async (id: string, customFetch?: Fetch) => {
  return apiFetch(`/api/runtimes/${id}/sessions`, {
    fetch: customFetch,
  }) as Promise<RuntimeSessionsResponse>;
};

export const getRuntimeSessionGraph = async (id: string, customFetch?: Fetch) => {
  return apiFetch(`/api/runtimes/${id}/session-graph`, {
    fetch: customFetch,
  }) as Promise<RuntimeSessionsResponse>;
};

export const getRuntimeStreamUrl = (id: string) => {
  const base = API_BASE_URL;
  return base
    ? `${base}/api/runtimes/${id}/stream`
    : `/api/runtimes/${id}/stream`;
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
