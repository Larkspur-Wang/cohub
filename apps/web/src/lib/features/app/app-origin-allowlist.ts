/**
 * Origin allowlist for the app auth broker (§8.1 of the plan).
 *
 * This is the real security boundary that prevents unrelated third-party sites
 * from impersonating an arbitrary appId to mint a visitor's restricted app
 * session token. The broker validates the opener's origin against this list
 * before processing any request.
 *
 * For now this is a hardcoded list (Cohub public domain + neta.art + localhost).
 * Author-configurable per-app origins are a future enhancement (§8.1 placeholder).
 */

const EXACT_ALLOWED_ORIGINS = new Set<string>([
	// Cohub public domain itself (for the case where a public work page opens
	// the broker directly).
	"https://cohub.live",
	"https://www.cohub.live",
	"https://cohub.run",
	"https://www.cohub.run",
	// neta.art trusted root domain and wildcard subdomains.
	"https://neta.art",
	"https://www.neta.art",
]);

const ALLOWED_SUFFIXES = [".neta.art", ".cohub.live", ".cohub.run"];

/**
 * Returns true when the given origin is allowed to use the work auth broker.
 *
 * - HTTPS is enforced for all non-localhost origins.
 * - localhost / 127.0.0.1 on any port are always allowed for local dev.
 * - Exact matches and suffix matches (*.neta.art, *.cohub.live, *.cohub.run) are checked.
 */
export function isAllowedAppOrigin(origin: string): boolean {
	if (!origin) return false;

	// Localhost / 127.0.0.1 on any port — dev convenience.
	if (
		origin.startsWith("http://localhost:") ||
		origin === "http://localhost" ||
		origin.startsWith("http://127.0.0.1:") ||
		origin === "http://127.0.0.1"
	) {
		return true;
	}

	// All other origins must be HTTPS.
	if (!origin.startsWith("https://")) return false;

	if (EXACT_ALLOWED_ORIGINS.has(origin)) return true;

	try {
		const { hostname } = new URL(origin);
		return ALLOWED_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
	} catch {
		return false;
	}
}
