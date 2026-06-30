export type NormalizeWorkspaceFileLinkOptions = {
	/** Current workspace-relative Markdown file path. Used for relative links. */
	basePath?: string | null;
};

const SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

function stripQueryAndHash(value: string) {
	const queryIndex = value.indexOf("?");
	const hashIndex = value.indexOf("#");
	const cutIndex = [queryIndex, hashIndex]
		.filter((index) => index >= 0)
		.sort((a, b) => a - b)[0];
	return cutIndex === undefined ? value : value.slice(0, cutIndex);
}

function safeDecodeUri(value: string) {
	try {
		return decodeURI(value);
	} catch {
		return null;
	}
}

function dirname(path: string) {
	const normalized = normalizeWorkspacePath(path);
	if (!normalized?.includes("/")) return "";
	return normalized.slice(0, normalized.lastIndexOf("/"));
}

function hasControlCharacter(value: string) {
	return Array.from(value).some((char) => {
		const code = char.charCodeAt(0);
		return code <= 0x1f || code === 0x7f;
	});
}

function normalizeWorkspacePath(path: string) {
	if (!path || path.includes("\\") || hasControlCharacter(path)) return null;
	const parts: string[] = [];
	for (const segment of path.split("/")) {
		if (!segment || segment === ".") continue;
		if (segment === "..") {
			if (parts.length === 0) return null;
			parts.pop();
			continue;
		}
		parts.push(segment);
	}
	return parts.length > 0 ? parts.join("/") : null;
}

/**
 * Converts Markdown hrefs that refer to files inside /workspace into the
 * workspace-relative path used by the file tree and preview panel.
 */
export function normalizeWorkspaceFileLink(
	href: string,
	options: NormalizeWorkspaceFileLinkOptions = {},
) {
	const raw = href.trim();
	if (!raw || raw.startsWith("#")) return null;
	if (raw.startsWith("//") || SCHEME_PATTERN.test(raw)) return null;

	const withoutQuery = stripQueryAndHash(raw).trim();
	if (!withoutQuery) return null;

	const decoded = safeDecodeUri(withoutQuery)?.trim();
	if (!decoded || decoded.startsWith("#")) return null;
	if (decoded.startsWith("//") || SCHEME_PATTERN.test(decoded)) return null;
	if (decoded.includes("\\") || hasControlCharacter(decoded)) return null;

	if (decoded === "/workspace" || decoded === "workspace") return null;

	if (decoded.startsWith("/")) {
		if (!decoded.startsWith("/workspace/")) return null;
		return normalizeWorkspacePath(decoded.slice("/workspace/".length));
	}

	if (decoded.startsWith("workspace/")) {
		return normalizeWorkspacePath(decoded.slice("workspace/".length));
	}

	const baseDir = options.basePath ? dirname(options.basePath) : "";
	return normalizeWorkspacePath(baseDir ? `${baseDir}/${decoded}` : decoded);
}
