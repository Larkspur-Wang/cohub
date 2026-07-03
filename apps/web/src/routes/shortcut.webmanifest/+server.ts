import type { RequestHandler } from "@sveltejs/kit";

const PUBLIC_WORK_SEGMENT = "w";
const SPACE_WORK_SEGMENT = "works";
const THEME_COLOR = "#1F2026";
const BACKGROUND_COLOR = "#1a1a1a";
const RESERVED_PUBLIC_ROOTS = new Set([
	"callback",
	"explore",
	"invite",
	"pricing",
	"settings",
	"spaces",
	"trending",
]);

type ShortcutKind = "space" | "work";

type ShortcutTarget = {
	kind: ShortcutKind;
	startUrl: string;
};

function isPublicWorkPath(segments: string[]) {
	return segments.length === 4 && segments[2] === PUBLIC_WORK_SEGMENT;
}

function isAppWorkPath(segments: string[]) {
	return (
		segments.length === 4 &&
		segments[0] === "spaces" &&
		segments[2] === SPACE_WORK_SEGMENT
	);
}

function isAppSpacePath(segments: string[]) {
	return (
		segments[0] === "spaces" && segments.length >= 2 && segments[1] !== "new"
	);
}

function isPublicSpacePath(segments: string[]) {
	return segments.length === 2 && !RESERVED_PUBLIC_ROOTS.has(segments[0] ?? "");
}

function resolveShortcutTarget(requestUrl: URL): ShortcutTarget | null {
	const rawStartUrl = requestUrl.searchParams.get("start_url");
	if (!rawStartUrl) return null;

	const parsed = new URL(rawStartUrl, requestUrl.origin);
	if (parsed.origin !== requestUrl.origin) return null;

	const segments = parsed.pathname.split("/").filter(Boolean);
	if (isPublicWorkPath(segments) || isAppWorkPath(segments)) {
		return { kind: "work", startUrl: parsed.pathname };
	}
	if (isAppSpacePath(segments) || isPublicSpacePath(segments)) {
		return { kind: "space", startUrl: parsed.pathname };
	}
	return null;
}

export const GET: RequestHandler = ({ url }) => {
	const target = resolveShortcutTarget(url) ?? { kind: "space", startUrl: "/" };
	const isWork = target.kind === "work";
	const manifest = {
		name: isWork ? "Cohub Work" : "Cohub Space",
		short_name: isWork ? "Cohub Work" : "Cohub Space",
		description: isWork
			? "Open a Cohub Work directly"
			: "Open a Cohub Space directly",
		id: target.startUrl,
		start_url: target.startUrl,
		scope: "/",
		theme_color: THEME_COLOR,
		background_color: BACKGROUND_COLOR,
		display: "standalone",
		icons: [
			{
				src: "/pwa/icon-192x192.png",
				sizes: "192x192",
				type: "image/png",
			},
			{
				src: "/pwa/icon-512x512.png",
				sizes: "512x512",
				type: "image/png",
			},
		],
	};

	return new Response(JSON.stringify(manifest), {
		headers: {
			"cache-control": "public, max-age=300",
			"content-type": "application/manifest+json; charset=utf-8",
		},
	});
};
