import { Buffer } from "node:buffer";

import { config } from "./config.js";

export type GiteaEntry = {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink" | "submodule";
  size: number;
  sha: string;
};

type GiteaFileResponse = {
  type: "file";
  encoding?: string;
  content?: string;
  name: string;
  path: string;
  sha: string;
  size: number;
};

type GiteaRepository = {
  name: string;
  owner: {
    username: string;
  };
  ssh_url: string;
  html_url: string;
};

type GiteaDeployKey = {
  id: number;
  key: string;
  read_only: boolean;
};

export type ManagedGiteaUser = {
  id: number;
  login: string;
  username?: string;
  email?: string;
};

type ManagedGiteaAccessToken = {
  id: number;
  name: string;
  sha1: string;
  token_last_eight?: string;
};

export type GiteaUserVisibility = "public" | "limited" | "private";

const createGiteaHeaders = () => {
  if (!config.giteaToken) {
    return undefined;
  }

  return {
    Authorization: `token ${config.giteaToken}`,
  };
};

const giteaGet = async <T>(path: string) => {
  const response = await fetch(`${config.giteaBaseUrl}/api/v1${path}`, {
    headers: createGiteaHeaders(),
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gitea API error: ${response.status} ${text}`);
  }

  return (await response.json()) as T;
};

const giteaPost = async <T>(path: string, body: unknown) => {
  const headers = createGiteaHeaders();
  if (!headers) {
    throw new Error("GITEA_TOKEN is not configured");
  }

  const response = await fetch(`${config.giteaBaseUrl}/api/v1${path}`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gitea API POST error: ${response.status} ${text}`);
  }

  return (await response.json()) as T;
};

export const getRepository = async (owner: string, repo: string) => {
  return giteaGet<Record<string, unknown>>(`/repos/${owner}/${repo}`);
};

export const getGiteaUserByUsername = async (username: string) => {
  return giteaGet<ManagedGiteaUser>(`/admin/users/${encodeURIComponent(username)}`);
};

export const createManagedGiteaUser = async (input: {
  username: string;
  email: string;
  password: string;
  mustChangePassword?: boolean;
  sendNotify?: boolean;
  visibility?: GiteaUserVisibility;
}) => {
  return giteaPost<ManagedGiteaUser>("/admin/users", {
    email: input.email,
    login_name: input.username,
    password: input.password,
    username: input.username,
    must_change_password: input.mustChangePassword ?? false,
    send_notify: input.sendNotify ?? false,
    restricted: false,
    visibility: input.visibility ?? "limited",
  });
};

export const createManagedGiteaAccessToken = async (
  username: string,
  tokenName: string,
) => {
  return giteaPost<ManagedGiteaAccessToken>(
    `/users/${encodeURIComponent(username)}/tokens`,
    {
      name: tokenName,
    },
  );
};

export const createGiteaAccessTokenWithBasicAuth = async (
  username: string,
  password: string,
  tokenName: string,
) => {
  const response = await fetch(
    `${config.giteaBaseUrl}/api/v1/users/${encodeURIComponent(username)}/tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: tokenName,
        scopes: ["read:user", "write:user", "read:repository", "write:repository"],
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gitea create token with basic auth error: ${response.status} ${text}`);
  }

  return (await response.json()) as ManagedGiteaAccessToken;
};

export const createRepository = async (
  token: string,
  name: string,
  isPrivate = false,
) => {
  const response = await fetch(`${config.giteaBaseUrl}/api/v1/user/repos`, {
    method: "POST",
    headers: {
      Authorization: `token ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      private: isPrivate,
      auto_init: false,
    }),
  });

  if (response.status === 409) {
    return { name, alreadyExists: true };
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gitea create repo error: ${response.status} ${text}`);
  }

  return response.json();
};

export const addSshKey = async (token: string, key: string, title: string) => {
  const response = await fetch(`${config.giteaBaseUrl}/api/v1/user/keys`, {
    method: "POST",
    headers: {
      Authorization: `token ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      key,
      title,
      read_only: false,
    }),
  });

  if (response.status === 422) {
    return { alreadyExists: true };
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gitea add SSH key error: ${response.status} ${text}`);
  }

  return response.json() as Promise<GiteaSshKey>;
};

export type GiteaSshKey = {
  id: number;
  key: string;
  title: string;
  read_only: boolean;
};

export const deleteSshKey = async (token: string, keyId: number) => {
  const response = await fetch(`${config.giteaBaseUrl}/api/v1/user/keys/${keyId}`, {
    method: "DELETE",
    headers: {
      Authorization: `token ${token}`,
    },
  });

  if (response.status === 404) {
    return { notFound: true };
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gitea delete SSH key error: ${response.status} ${text}`);
  }

  return { ok: true };
};

export const listSshKeys = async (token: string): Promise<GiteaSshKey[]> => {
  const response = await fetch(`${config.giteaBaseUrl}/api/v1/user/keys`, {
    headers: {
      Authorization: `token ${token}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gitea list SSH keys error: ${response.status} ${text}`);
  }

  return response.json() as Promise<GiteaSshKey[]>;
};

export const addDeployKeyToRepo = async (
  owner: string,
  repo: string,
  key: string,
  title: string,
): Promise<GiteaDeployKey> => {
  const deployKey = await giteaPost<GiteaDeployKey>(
    `/repos/${owner}/${repo}/keys`,
    {
      key,
      title,
      read_only: false,
    },
  );
  return deployKey;
};

export const getDirectoryEntries = async (
  owner: string,
  repo: string,
  path: string,
  ref?: string,
) => {
  const encodedPath = path
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");

  const query = new URLSearchParams();
  if (ref) {
    query.set("ref", ref);
  }

  const urlPath = encodedPath
    ? `/repos/${owner}/${repo}/contents/${encodedPath}`
    : `/repos/${owner}/${repo}/contents`;
  const suffix = query.size > 0 ? `?${query.toString()}` : "";

  const data = await giteaGet<Array<GiteaEntry> | GiteaFileResponse>(
    `${urlPath}${suffix}`,
  );

  if (!data) {
    return null;
  }

  if (!Array.isArray(data)) {
    return [];
  }

  return data
    .map((entry) => ({
      name: entry.name,
      path: entry.path,
      type: entry.type,
      size: entry.size,
      sha: entry.sha,
    }))
    .sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "dir" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
};

export const getFileContent = async (
  owner: string,
  repo: string,
  path: string,
  ref?: string,
) => {
  const cleanPath = path
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  if (!cleanPath) {
    return null;
  }

  const query = new URLSearchParams();
  if (ref) {
    query.set("ref", ref);
  }

  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const data = await giteaGet<GiteaFileResponse>(
    `/repos/${owner}/${repo}/contents/${cleanPath}${suffix}`,
  );

  if (!data || data.type !== "file") {
    return null;
  }

  const rawContent = data.content ? data.content.replace(/\n/g, "") : "";
  const encoding = data.encoding ?? "base64";
  const content =
    encoding === "base64"
      ? Buffer.from(rawContent, "base64").toString("utf-8")
      : rawContent;

  return {
    name: data.name,
    path: data.path,
    sha: data.sha,
    size: data.size,
    encoding,
    content,
  };
};

export type GiteaForkResponse = {
  id: number;
  name: string;
  owner: {
    id: number;
    username: string;
    login: string;
  };
  full_name: string;
  html_url: string;
  ssh_url: string;
  clone_url: string;
  parent?: {
    id: number;
    name: string;
    full_name: string;
    owner: {
      username: string;
      login: string;
    };
  };
};

export const forkRepository = async (
  owner: string,
  repo: string,
  userToken: string,
  targetRepoName?: string,
): Promise<GiteaForkResponse> => {
  const response = await fetch(
    `${config.giteaBaseUrl}/api/v1/repos/${owner}/${repo}/forks`,
    {
      method: "POST",
      headers: {
        Authorization: `token ${userToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        targetRepoName ? { name: targetRepoName } : {},
      ),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gitea fork repo error: ${response.status} ${text}`);
  }

  return (await response.json()) as GiteaForkResponse;
};

export const getRepositoryForks = async (
  owner: string,
  repo: string,
  page = 1,
  limit = 50,
): Promise<{ forks: GiteaForkResponse[]; total: number }> => {
  const response = await fetch(
    `${config.giteaBaseUrl}/api/v1/repos/${owner}/${repo}/forks?page=${page}&limit=${limit}`,
    {
      headers: createGiteaHeaders(),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gitea get forks error: ${response.status} ${text}`);
  }

  const data = await response.json();
  return {
    forks: Array.isArray(data) ? data : [],
    total: Array.isArray(data) ? data.length : 0,
  };
};

export const updateRepositoryVisibility = async (
  owner: string,
  repo: string,
  isPrivate: boolean,
): Promise<GiteaRepository> => {
  const headers = createGiteaHeaders();
  if (!headers) {
    throw new Error("GITEA_TOKEN is not configured");
  }

  const response = await fetch(
    `${config.giteaBaseUrl}/api/v1/repos/${owner}/${repo}`,
    {
      method: "PATCH",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        private: isPrivate,
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gitea update repo visibility error: ${response.status} ${text}`);
  }

  return (await response.json()) as GiteaRepository;
};

export const deleteRepository = async (owner: string, repo: string) => {
  const headers = createGiteaHeaders();
  if (!headers) {
    throw new Error("GITEA_TOKEN is not configured");
  }

  const response = await fetch(`${config.giteaBaseUrl}/api/v1/repos/${owner}/${repo}`, {
    method: "DELETE",
    headers,
  });

  if (response.status === 404) {
    return { ok: true, notFound: true };
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gitea delete repo error: ${response.status} ${text}`);
  }

  return { ok: true, notFound: false };
};
