/** Public-page locale helpers shared by SSR hooks and client runtime. */

export type PublicLocale = "en" | "zh-CN";

/**
 * Public locale is URL-driven only (never Cookie / Accept-Language):
 * a leading `/zh` segment → zh-CN, otherwise en.
 */
export function resolvePublicLocale(pathname: string): PublicLocale {
	if (pathname === "/zh" || pathname.startsWith("/zh/")) return "zh-CN";
	return "en";
}

/**
 * Whether `pathname` belongs to a public page whose language is URL-driven
 * (rather than the client-preference-driven app shell). Lang for these pages
 * must match the SSR HTML so hydration / accessibility stay consistent.
 */
export function isPublicLocalePath(pathname: string): boolean {
	if (pathname === "/" || pathname === "") return true;
	if (
		pathname.startsWith("/docs") ||
		pathname.startsWith("/pricing") ||
		pathname.startsWith("/changelog") ||
		pathname.startsWith("/trending")
	) {
		return true;
	}
	if (
		pathname.startsWith("/invite") ||
		pathname.startsWith("/referrals") ||
		pathname.startsWith("/app-auth") ||
		pathname === "/callback"
	) {
		return true;
	}
	const segments = pathname.split("/").filter(Boolean);
	// Public Work / App and space-join share URLs; they are not locale-prefixed.
	if (
		segments.length === 4 &&
		(segments[2] === "w" || segments[2] === "join")
	) {
		return true;
	}
	if (segments[0] === "zh") return true;
	return false;
}
