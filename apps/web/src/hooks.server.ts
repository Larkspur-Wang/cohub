import type { Handle } from "@sveltejs/kit";
import {
	isPublicSharePath,
	PUBLIC_NOT_FOUND_CACHE_CONTROL,
} from "$lib/server/public-cache";

/** Set <html lang> for prerendered / SSR HTML (client SPA nav is handled in docs layout). */
export const handle: Handle = async ({ event, resolve }) => {
	const lang = event.url.pathname.startsWith("/docs/zh") ? "zh-CN" : "en";

	const response = await resolve(event, {
		transformPageChunk: ({ html }) =>
			html.replace(/<html lang="[^"]*">/, `<html lang="${lang}">`),
	});

	// error() paths drop load setHeaders(); apply a short public 404 cache here.
	if (
		response.status === 404 &&
		isPublicSharePath(event.url.pathname) &&
		!response.headers.has("cache-control")
	) {
		response.headers.set("cache-control", PUBLIC_NOT_FOUND_CACHE_CONTROL);
	}

	return response;
};
