import type { Handle } from "@sveltejs/kit";

/** Set <html lang> for prerendered / SSR HTML (client SPA nav is handled in docs layout). */
export const handle: Handle = async ({ event, resolve }) => {
	const lang = event.url.pathname.startsWith("/docs/zh") ? "zh-CN" : "en";

	return resolve(event, {
		transformPageChunk: ({ html }) =>
			html.replace(/<html lang="[^"]*">/, `<html lang="${lang}">`),
	});
};
