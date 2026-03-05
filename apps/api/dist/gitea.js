import { Buffer } from "node:buffer";
import { config } from "./config.js";
const createGiteaHeaders = () => {
    if (!config.giteaToken) {
        return undefined;
    }
    return {
        Authorization: `token ${config.giteaToken}`
    };
};
const giteaGet = async (path) => {
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
    return (await response.json());
};
export const getRepository = async (owner, repo) => {
    return giteaGet(`/repos/${owner}/${repo}`);
};
export const getDirectoryEntries = async (owner, repo, path, ref) => {
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
    const data = await giteaGet(`${urlPath}${suffix}`);
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
export const getFileContent = async (owner, repo, path, ref) => {
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
    const data = await giteaGet(`/repos/${owner}/${repo}/contents/${cleanPath}${suffix}`);
    if (!data || data.type !== "file") {
        return null;
    }
    const rawContent = data.content ? data.content.replace(/\n/g, "") : "";
    const encoding = data.encoding ?? "base64";
    const content = encoding === "base64"
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
