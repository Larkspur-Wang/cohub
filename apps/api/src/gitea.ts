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

const createGiteaHeaders = () => {
  if (!config.giteaToken) {
    return undefined;
  }

  return {
    Authorization: `token ${config.giteaToken}`
  };
};

const giteaGet = async <T>(path: string) => {
  const response = await fetch(`${config.giteaBaseUrl}/api/v1${path}`, {
    headers: createGiteaHeaders()
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

export const getRepository = async (owner: string, repo: string) => {
  return giteaGet<Record<string, unknown>>(`/repos/${owner}/${repo}`);
};

export const createRepository = async (token: string, name: string, isPrivate = true) => {
  const response = await fetch(`${config.giteaBaseUrl}/api/v1/user/repos`, {
    method: "POST",
    headers: {
      Authorization: `token ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name,
      private: isPrivate,
      auto_init: false
    })
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
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      key,
      title,
      read_only: false
    })
  });

  if (response.status === 422) {
    return { alreadyExists: true };
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gitea add SSH key error: ${response.status} ${text}`);
  }

  return response.json();
};

export const getDirectoryEntries = async (
  owner: string,
  repo: string,
  path: string,
  ref?: string
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

  const data = await giteaGet<Array<GiteaEntry> | GiteaFileResponse>(`${urlPath}${suffix}`);

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
      sha: entry.sha
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
  ref?: string
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
    `/repos/${owner}/${repo}/contents/${cleanPath}${suffix}`
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
    content
  };
};
