import type { RequestHandler } from "@sveltejs/kit";

const PUBLIC_WORK_SEGMENT = "w";
const THEME_COLOR = "#1F2026";
const BACKGROUND_COLOR = "#1a1a1a";

function isPublicWorkPath(pathname: string) {
	const segments = pathname.split("/").filter(Boolean);
	return segments.length === 4 && segments[2] === PUBLIC_WORK_SEGMENT;
}

function resolveStartUrl(requestUrl: URL) {
	const rawStartUrl = requestUrl.searchParams.get("start_url");
	if (!rawStartUrl) return "/";

	const parsed = new URL(rawStartUrl, requestUrl.origin);
	if (
		parsed.origin !== requestUrl.origin ||
		!isPublicWorkPath(parsed.pathname)
	) {
		return "/";
	}

	return parsed.pathname;
}

export const GET: RequestHandler = ({ url }) => {
	const startUrl = resolveStartUrl(url);
	const manifest = {
		name: "Cohub Work",
		short_name: "Cohub Work",
		description: "Open a Cohub Work directly",
		id: startUrl,
		start_url: startUrl,
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
