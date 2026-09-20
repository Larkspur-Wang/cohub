import { isUuid } from "./identifiers.js";

/**
 * Placeholder replaced with the App id in a standalone App hostname template,
 * for example `{id}.apps.example.com`.
 */
export const COHUB_APP_HOST_TOKEN = "{id}";

/**
 * Hostname template for published App standalone origins, supplied by
 * deployment configuration. Standalone origins are opt-in: without a template
 * no App has one, and origin-to-App resolution is disabled.
 */
export type CohubAppHostTemplate = string;

const HOSTNAME_RE =
	/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const PROBE_APP_ID = "00000000-0000-4000-8000-000000000000";

function splitTemplate(
	template: string,
): { prefix: string; suffix: string } | null {
	const parts = template.split(COHUB_APP_HOST_TOKEN);
	if (parts.length !== 2) return null;
	const [prefix, suffix] = parts;
	return prefix === undefined || suffix === undefined
		? null
		: { prefix, suffix };
}

/**
 * Normalizes deployment configuration into a hostname template. Returns null
 * when the value is absent or is not a single-`{id}` valid hostname.
 */
export function parseCohubAppHostTemplate(
	value: string | null | undefined,
): CohubAppHostTemplate | null {
	const template = value?.trim().toLowerCase();
	if (!template) return null;
	const parts = splitTemplate(template);
	if (!parts) return null;
	const probe = `${parts.prefix}${PROBE_APP_ID}${parts.suffix}`;
	return HOSTNAME_RE.test(probe) ? template : null;
}

export function createCohubAppHostname(
	appId: string,
	template: CohubAppHostTemplate,
): string {
	return template.replace(COHUB_APP_HOST_TOKEN, appId.toLowerCase());
}

export function createCohubAppOrigin(
	appId: string,
	template: CohubAppHostTemplate,
): string {
	return `https://${createCohubAppHostname(appId, template)}`;
}

/** Resolves the App id from a managed standalone hostname, or null. */
export function resolveCohubAppIdFromHostname(
	hostname: string,
	template: CohubAppHostTemplate,
): string | null {
	const parts = splitTemplate(template);
	if (!parts) return null;
	const host = hostname.trim().toLowerCase();
	if (!host.startsWith(parts.prefix) || !host.endsWith(parts.suffix)) return null;
	const end = host.length - parts.suffix.length;
	if (end <= parts.prefix.length) return null;
	const appId = host.slice(parts.prefix.length, end);
	return isUuid(appId) ? appId : null;
}

export function isCohubAppHostname(
	hostname: string,
	template: CohubAppHostTemplate,
): boolean {
	return resolveCohubAppIdFromHostname(hostname, template) !== null;
}

/** Resolves only managed standalone origins, e.g. `https://<id>.apps.example.com`. */
export function resolveCohubAppOrigin(
	origin: string | null | undefined,
	template: CohubAppHostTemplate,
): string | null {
	if (!origin) return null;
	try {
		const url = new URL(origin);
		if (url.protocol !== "https:" || url.port || url.origin !== origin)
			return null;
		return resolveCohubAppIdFromHostname(url.hostname, template);
	} catch {
		return null;
	}
}
