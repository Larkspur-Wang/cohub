/** Shared helpers for public marketing / content SEO. */

const DEFAULT_ORIGIN = "https://cohub.run";

export function siteOrigin(originFromPage?: string | null): string {
	const fromEnv =
		typeof process !== "undefined"
			? process.env.PUBLIC_SITE_ORIGIN?.trim().replace(/\/$/, "")
			: undefined;
	if (fromEnv) return fromEnv;

	const fromPage = (originFromPage ?? "").replace(/\/$/, "");
	if (
		fromPage.startsWith("http") &&
		!fromPage.includes("sveltekit-prerender")
	) {
		return fromPage;
	}

	return DEFAULT_ORIGIN;
}

export function canonicalUrl(
	originFromPage: string | null | undefined,
	path: string,
): string {
	const origin = siteOrigin(originFromPage);
	const normalized = path.startsWith("/") ? path : `/${path}`;
	return `${origin}${normalized === "/" ? "/" : normalized.replace(/\/$/, "")}`;
}

/** Strip simple inline markdown used in changelog copy. */
export function plainText(input: string): string {
	return input
		.replace(/\*\*(.+?)\*\*/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/\s+/g, " ")
		.trim();
}

export function truncate(text: string, max = 160): string {
	if (text.length <= max) return text;
	const slice = text.slice(0, max - 1);
	const cut = slice.lastIndexOf(" ");
	return `${(cut > 80 ? slice.slice(0, cut) : slice).trimEnd()}…`;
}
