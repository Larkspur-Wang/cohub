import type { RequestHandler } from "@sveltejs/kit";
import { loadPublicWorkDetail } from "$lib/server/work-pwa";
import { buildWorkPwaMeta, resolvePublicWorkStartUrl } from "$lib/work-pwa";

const THEME_COLOR = "#1F2026";
const BACKGROUND_COLOR = "#1a1a1a";

function buildIcons() {
	return [
		{
			src: "/pwa/work-icon-192x192.png",
			sizes: "192x192",
			type: "image/png",
		},
		{
			src: "/pwa/work-icon-512x512.png",
			sizes: "512x512",
			type: "image/png",
		},
		{
			src: "/pwa/work-icon-maskable-192x192.png",
			sizes: "192x192",
			type: "image/png",
			purpose: "maskable",
		},
		{
			src: "/pwa/work-icon-maskable-512x512.png",
			sizes: "512x512",
			type: "image/png",
			purpose: "maskable",
		},
	];
}

export const GET: RequestHandler = async ({ fetch, url }) => {
	const { startUrl, path } = resolvePublicWorkStartUrl(url);
	const detail = await loadPublicWorkDetail(path, fetch);
	const meta = buildWorkPwaMeta(detail);
	const manifest = {
		name: meta.name,
		short_name: meta.shortName,
		description: meta.description,
		id: startUrl,
		start_url: startUrl,
		scope: "/",
		theme_color: THEME_COLOR,
		background_color: BACKGROUND_COLOR,
		display: "standalone",
		icons: buildIcons(),
	};

	return new Response(JSON.stringify(manifest), {
		headers: {
			"cache-control": "public, max-age=300",
			"content-type": "application/manifest+json; charset=utf-8",
		},
	});
};
