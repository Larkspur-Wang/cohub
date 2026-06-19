export type CohubWorkUrl = {
	username: string;
	spaceSlug: string;
	workSlug: string;
};

function isSameCohubOrigin(url: URL, base: URL) {
	return url.origin === base.origin;
}

export function parseCohubWorkUrl(
	value: string,
	baseHref: string,
): CohubWorkUrl | null {
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
	const [username, spaceSlug, , workSlug] = segments;
	if (!username || !spaceSlug || !workSlug) return null;
	try {
		return {
			username: decodeURIComponent(username),
			spaceSlug: decodeURIComponent(spaceSlug),
			workSlug: decodeURIComponent(workSlug),
		};
	} catch {
		return null;
	}
}
