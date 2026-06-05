const IMAGE_EXTENSIONS = new Set([
	".apng",
	".avif",
	".gif",
	".jpg",
	".jpeg",
	".png",
	".svg",
	".webp",
]);

const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".ogg", ".ogv"]);

function extensionOf(path: string) {
	try {
		const url = new URL(path, "https://cohub.local");
		path = url.pathname;
	} catch {
		// keep raw path
	}
	const index = path.lastIndexOf(".");
	return index >= 0 ? path.slice(index).toLowerCase() : "";
}

function isExternalUrl(value: string) {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

function isRelativeAssetUrl(value: string) {
	if (
		!value ||
		value.startsWith("#") ||
		value.startsWith("/") ||
		value.startsWith("data:")
	) {
		return false;
	}
	return !isExternalUrl(value);
}

function dirname(path: string) {
	const normalized = path.replace(/^\/+/, "");
	const index = normalized.lastIndexOf("/");
	return index >= 0 ? normalized.slice(0, index) : "";
}

function normalizeRelativePath(baseDir: string, target: string) {
	const [pathPart, suffix = ""] = target.split(/(?=[?#])/, 2);
	const parts = `${baseDir ? `${baseDir}/` : ""}${pathPart}`.split("/");
	const stack: string[] = [];
	for (const part of parts) {
		if (!part || part === ".") continue;
		if (part === "..") {
			stack.pop();
			continue;
		}
		stack.push(part);
	}
	return `${stack.join("/")}${suffix}`;
}

function buildSpaceFileUrl(spaceId: string, path: string) {
	return `/api/spaces/${encodeURIComponent(spaceId)}/fs/download?path=${encodeURIComponent(path)}`;
}

function escapeHtml(value: string) {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function resolveAssetUrl(input: {
	spaceId: string;
	readmePath: string;
	url: string;
}) {
	const trimmed = input.url.trim();
	if (isRelativeAssetUrl(trimmed)) {
		return buildSpaceFileUrl(
			input.spaceId,
			normalizeRelativePath(dirname(input.readmePath), trimmed),
		);
	}
	return trimmed;
}

export function prepareReadmeMarkdown(input: {
	markdown: string;
	spaceId: string;
	readmePath: string;
}) {
	return input.markdown.replace(
		/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
		(match, alt: string, rawUrl: string) => {
			const url = rawUrl.trim();
			const ext = extensionOf(url);
			if (!IMAGE_EXTENSIONS.has(ext) && !VIDEO_EXTENSIONS.has(ext))
				return match;
			const resolvedUrl = resolveAssetUrl({
				spaceId: input.spaceId,
				readmePath: input.readmePath,
				url,
			});
			if (VIDEO_EXTENSIONS.has(ext)) {
				return `<video controls preload="metadata" src="${escapeHtml(resolvedUrl)}" title="${escapeHtml(alt)}"></video>`;
			}
			return `![${alt}](${resolvedUrl})`;
		},
	);
}
