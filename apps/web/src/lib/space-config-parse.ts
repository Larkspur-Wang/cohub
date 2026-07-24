import {
	parseWorkspaceDefaultLayout,
	type WorkspaceDefaultLayout,
	type WorkspaceLayoutPresentation,
} from "$lib/features/space/modules/workspace-default-layout";

export type { WorkspaceDefaultLayout, WorkspaceLayoutPresentation };

type NewChatBackgroundBase = {
	opacity: number;
	fit: "cover" | "contain" | "fill";
	position: string;
};

type NewChatBackgroundUrlSource = {
	kind: "url";
	url: string;
};

export type NewChatBackgroundConfig = NewChatBackgroundBase &
	(
		| {
				type: "html";
				source: NewChatBackgroundUrlSource | { kind: "space"; path: string };
		  }
		| {
				type: "image" | "video";
				source: NewChatBackgroundUrlSource;
		  }
	);

export type NewChatComposerApplyPayload = {
	prompt?: string;
	model?: {
		provider: string;
		id: string;
	};
	images?: Array<{
		url: string;
		name?: string;
	}>;
};

export type SpaceConfig = {
	ui?: {
		newChat?: {
			background?: NewChatBackgroundConfig;
		};
		workspace?: {
			defaultLayout?: WorkspaceDefaultLayout;
		};
	};
};

function parseBackgroundUrl(value: unknown) {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
	try {
		const url = new URL(trimmed);
		return url.protocol === "https:" ? url.href : null;
	} catch {
		return null;
	}
}

/**
 * A space-local file reference: a relative path served from the viewer's own
 * Space (not the web-app origin). Distinguished from `url` by having no
 * protocol and no leading slash. Rejects path traversal and absolute forms.
 */
function parseSpacePath(value: unknown) {
	if (typeof value !== "string") return null;
	const trimmed = value.trim().replace(/^\.\/+/, "");
	if (!trimmed) return null;
	// Absolute paths, protocol-relative, and explicit URLs are handled by
	// parseBackgroundUrl — not space-local.
	if (trimmed.startsWith("/")) return null;
	if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;
	// No traversal or empty segments.
	const segments = trimmed.split("/");
	if (segments.some((seg) => seg === "" || seg === "." || seg === "..")) {
		return null;
	}
	return trimmed;
}

function parseOptionalNumber(
	value: unknown,
	fallback: number,
	min: number,
	max: number,
) {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, value));
}

function parseBackground(value: unknown): NewChatBackgroundConfig | undefined {
	if (!value || typeof value !== "object") return undefined;
	const record = value as Record<string, unknown>;
	if (record.enabled === false) return undefined;
	const url = parseBackgroundUrl(record.url);
	const type =
		record.type === "image" || record.type === "video" || record.type === "html"
			? record.type
			: "html";
	// A space-local file path is only served for HTML boards, and only when no
	// external url resolved. This lets a Space point its New Chat board at its
	// own files so each viewer's board reflects their own Space.
	const spacePath = !url && type === "html" ? parseSpacePath(record.url) : null;
	if (!url && !spacePath) return undefined;
	const common: NewChatBackgroundBase = {
		opacity: parseOptionalNumber(record.opacity, 1, 0, 1),
		fit:
			record.fit === "contain" ||
			record.fit === "fill" ||
			record.fit === "cover"
				? record.fit
				: "cover",
		position: typeof record.position === "string" ? record.position : "center",
	};
	if (spacePath) {
		return {
			...common,
			type: "html",
			source: { kind: "space", path: spacePath },
		};
	}
	if (!url) return undefined;
	return {
		...common,
		type,
		source: { kind: "url", url },
	};
}

export function parseSpaceConfig(raw: string): SpaceConfig | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object") return null;
	const record = parsed as Record<string, unknown>;
	if (record.version !== undefined && record.version !== 1) return null;
	const ui =
		record.ui && typeof record.ui === "object"
			? (record.ui as Record<string, unknown>)
			: undefined;
	const newChat =
		ui?.newChat && typeof ui.newChat === "object"
			? (ui.newChat as Record<string, unknown>)
			: undefined;
	const workspace =
		ui?.workspace && typeof ui.workspace === "object"
			? (ui.workspace as Record<string, unknown>)
			: undefined;
	const background = parseBackground(newChat?.background);
	const defaultLayout = parseWorkspaceDefaultLayout(workspace?.defaultLayout);
	const next: SpaceConfig = {};
	if (background || defaultLayout) {
		next.ui = {};
		if (background) next.ui.newChat = { background };
		if (defaultLayout) next.ui.workspace = { defaultLayout };
	}
	return next;
}
