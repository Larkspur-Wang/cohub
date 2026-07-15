import { entries } from "$lib/changelog";
import { siteOrigin } from "$lib/seo";

export const prerender = true;

const STATIC_PATHS = ["/", "/pricing", "/changelog"] as const;

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

export function GET() {
	const origin = siteOrigin();
	const latest = entries[0]?.date ?? null;

	const body = [
		`<?xml version="1.0" encoding="UTF-8"?>`,
		`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
		...STATIC_PATHS.map((path) => {
			const loc = path === "/" ? `${origin}/` : `${origin}${path}`;
			const priority =
				path === "/" ? "1.0" : path === "/changelog" ? "0.8" : "0.7";
			const changefreq = path === "/changelog" ? "weekly" : "monthly";
			const lines = [`  <url>`, `    <loc>${escapeXml(loc)}</loc>`];
			if (path === "/changelog" && latest) {
				lines.push(`    <lastmod>${escapeXml(latest)}</lastmod>`);
			}
			lines.push(
				`    <changefreq>${changefreq}</changefreq>`,
				`    <priority>${priority}</priority>`,
				`  </url>`,
			);
			return lines.join("\n");
		}),
		`</urlset>`,
		``,
	].join("\n");

	return new Response(body, {
		headers: {
			"Content-Type": "application/xml; charset=utf-8",
			"Cache-Control": "public, max-age=3600",
		},
	});
}
