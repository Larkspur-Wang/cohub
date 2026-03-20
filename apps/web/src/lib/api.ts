const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

type ApiError = {
  message: string;
};

type Fetch = typeof globalThis.fetch;

type SessionRecord = {
  id: string;
  userUuid: string;
  workspaceId: string | null;
  workspaceCommitHash: string | null;
  agentId: string | null;
  agentCommitHash: string | null;
  title: string | null;
  status: string | null;
  createdAt: string;
  updatedAt: string;
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
  const base = API_BASE_URL;
  const url = base ? `${base}${path}` : path;

  const fetcher = init?.fetch ?? fetch;

  const response = await fetcher(url, {
    credentials: "include",
    ...init,
  });

  if (!response.ok) {
    const message = await response.text();
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

export const getTree = async (
  owner: string,
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
    `/api/workspaces/${owner}/${repo}/tree${query ? `?${query}` : ""}`,
    {
      fetch: customFetch,
    },
  );
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
  SessionRecord,
  SessionStreamEvent,
};
