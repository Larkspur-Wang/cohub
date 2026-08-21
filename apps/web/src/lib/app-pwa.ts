import {
	buildAppPwaMeta as buildSharedAppPwaMeta,
	type WorkPageDetail,
} from "$lib/app-page-meta";

export type WorkPwaDetail = WorkPageDetail;

const PUBLIC_WORK_SEGMENT = "w";

export type PublicWorkPath = {
	username: string;
	spaceSlug: string;
	appSlug: string;
	pathname: string;
};

export function parsePublicWorkPath(pathname: string): PublicWorkPath | null {
	const segments = pathname.split("/").filter(Boolean);
	if (segments.length !== 4 || segments[2] !== PUBLIC_WORK_SEGMENT) return null;
	const [username, spaceSlug, , appSlug] = segments;
	if (!username || !spaceSlug || !appSlug) return null;
	return { username, spaceSlug, appSlug, pathname: `/${segments.join("/")}` };
}

export function resolvePublicAppStartUrl(requestUrl: URL) {
	const rawStartUrl = requestUrl.searchParams.get("start_url");
	if (!rawStartUrl) return { startUrl: "/", path: null };

	let parsed: URL;
	try {
		parsed = new URL(rawStartUrl, requestUrl.origin);
	} catch {
		return { startUrl: "/", path: null };
	}
	if (parsed.origin !== requestUrl.origin) return { startUrl: "/", path: null };

	const path = parsePublicWorkPath(parsed.pathname);
	if (!path) return { startUrl: "/", path: null };

	return { startUrl: path.pathname, path };
}

export function buildAppPwaMeta(detail: WorkPwaDetail | null) {
	return buildSharedAppPwaMeta(detail);
}
