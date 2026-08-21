export type AppLaunchState = {
	search: string;
	hash: string;
};

export type CohubAppUrl = AppLaunchState & {
	username: string;
	spaceSlug: string;
	appSlug: string;
};

function isReservedAppParam(name: string) {
	return name.toLowerCase().startsWith("cohub_");
}

export function buildAppIframeUrl(
	contentUrl: string,
	launchState: AppLaunchState | null | undefined,
) {
	if (!launchState) return contentUrl;

	const launchParams = Array.from(
		new URLSearchParams(launchState.search).entries(),
	).filter(([name]) => !isReservedAppParam(name));
	if (launchParams.length === 0 && !launchState.hash) return contentUrl;

	let url: URL;
	try {
		url = new URL(contentUrl);
	} catch {
		return contentUrl;
	}

	for (const name of new Set(launchParams.map(([name]) => name))) {
		url.searchParams.delete(name);
	}
	for (const [name, value] of launchParams) {
		url.searchParams.append(name, value);
	}
	if (launchState.hash) url.hash = launchState.hash;
	return url.href;
}

function isSameCohubOrigin(url: URL, base: URL) {
	return url.origin === base.origin;
}

export function parseCohubAppUrl(
	value: string,
	baseHref: string,
): CohubAppUrl | null {
	let url: URL;
	let base: URL;
	try {
		base = new URL(baseHref);
		url = new URL(value, base);
	} catch {
		return null;
	}
	if (!isSameCohubOrigin(url, base)) return null;
	const segments = url.pathname.split("/").filter(Boolean);
	if (segments.length !== 4 || segments[2] !== "w") return null;
	const [username, spaceSlug, , appSlug] = segments;
	if (!username || !spaceSlug || !appSlug) return null;
	try {
		return {
			username: decodeURIComponent(username),
			spaceSlug: decodeURIComponent(spaceSlug),
			appSlug: decodeURIComponent(appSlug),
			search: url.search,
			hash: url.hash,
		};
	} catch {
		return null;
	}
}
