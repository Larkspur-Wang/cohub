import { goto } from "$app/navigation";

const API_BASE_URL = "";

type ApiError = {
  message: string;
};

type Fetch = typeof globalThis.fetch;

export type SessionRecord = {
  id: string;
  userUuid: string;
  workspaceId: string | null;
  workspaceCommitHash: string | null;
  agentId: string | null;
  agentCommitHash: string | null;
  title: string | null;
  status: string | null;
  rootMessageId?: string | null;
  currentLeafMessageId?: string | null;
  latestMessageText?: string | null;
  lastMessageAt?: string | null;
  totalMessages?: number;
  totalToolCalls?: number;
  totalBranches?: number;
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
      noteType: "branch_summary" | "compaction" | "info";
      text: string;
    };

export type SessionMessageRecord = {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: SessionMessageBlock[];
  text: string | null;
  parentMessageId: string | null;
  idempotencyKey?: string | null;
  depth: number;
  branchId: string;
  branchIndex: number | null;
  childCount: number;
  isBranchPoint: boolean;
  isLeaf: boolean;
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
  session: SessionRecord;
  messages: SessionMessageRecord[];
  toolCalls: SessionToolCallRecord[];
};

export type SessionTreeResponse = {
  session: {
    id: string;
    currentLeafMessageId: string | null;
    rootMessageId: string | null;
    totalBranches: number;
  };
  nodes: SessionMessageRecord[];
};

type SessionCreateResponse = {
  session: SessionRecord;
  ready: boolean;
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

export const getWorkspace = async (
  owner: string,
  repo: string,
  customFetch?: Fetch,
) => {
  return apiFetch(`/api/workspaces/${owner}/${repo}`, { fetch: customFetch });
};

export const getWorkspaceByUser = async (
  userUuid: string,
  repo: string,
  customFetch?: Fetch,
) => {
  return apiFetch(`/api/workspaces/by-user/${encodeURIComponent(userUuid)}/${repo}`, {
    fetch: customFetch,
  }) as Promise<GiteaRepo>;
};

export const getTreeByUser = async (
  userUuid: string,
  repo: string,
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
  return apiFetch(
    `/api/workspaces/by-user/${encodeURIComponent(userUuid)}/${repo}/tree${query ? `?${query}` : ""}`,
    { fetch: customFetch },
  ) as Promise<Tree>;
};

export const getFile = async (
  owner: string,
  repo: string,
  path: string,
  ref?: string,
  customFetch?: Fetch,
) => {
  const params = new URLSearchParams({ path });
  if (ref) {
    params.set("ref", ref);
  }
  return apiFetch(
    `/api/workspaces/${owner}/${repo}/file?${params.toString()}`,
    {
      fetch: customFetch,
    },
  );
};

export const createSession = async (input?: {
  workspaceId?: string;
  agentId?: string;
  title?: string;
}) => {
  return apiFetch("/api/sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input ?? {}),
  }) as Promise<SessionCreateResponse>;
};

export const getSession = async (id: string, customFetch?: Fetch) => {
  return apiFetch(`/api/sessions/${id}`, {
    fetch: customFetch,
  }) as Promise<SessionRecord>;
};

export const getSessionMessages = async (id: string, customFetch?: Fetch) => {
  return apiFetch(`/api/sessions/${id}/messages`, {
    fetch: customFetch,
  }) as Promise<SessionMessagesResponse>;
};

export const getSessionTree = async (id: string, customFetch?: Fetch) => {
  return apiFetch(`/api/sessions/${id}/tree`, {
    fetch: customFetch,
  }) as Promise<SessionTreeResponse>;
};

export const selectSessionLeaf = async (id: string, leafMessageId: string) => {
  return apiFetch(`/api/sessions/${id}/select-leaf`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ leafMessageId }),
  });
};

export const sendSessionMessage = async (
  id: string,
  input: {
    text: string;
    images?: Array<{ url: string }>;
    branchFromMessageId?: string;
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

export const abortSession = async (id: string) => {
  return apiFetch(`/api/sessions/${id}/abort`, {
    method: "POST",
  });
};

export const getSessionStreamUrl = (id: string) => {
  const base = API_BASE_URL;
  return base
    ? `${base}/api/sessions/${id}/stream`
    : `/api/sessions/${id}/stream`;
};

export type {
  ApiError,
  SessionCreateResponse,
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

export type Workspace = {
  id: string;
  userUuid: string;
  name: string;
  description: string | null;
  giteaRepoName: string;
  visibility: string;
  owner: string;
  createdAt: string;
  updatedAt: string;
};

export type TreeEntry = {
  name: string;
  path: string;
  type: "dir" | "file";
  size?: number;
};

export type Tree = {
  owner: string;
  repo: string;
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
  return apiFetch("/api/workspaces", { method: "GET", fetch: customFetch }) as Promise<Workspace[]>;
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
  });
};
