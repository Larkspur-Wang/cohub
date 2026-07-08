import type { WorkDetailResponse, WorkMeta } from "@neta-art/cohub";

export type WorkPwaDetail = Pick<WorkDetailResponse, "space"> & {
	work: Pick<WorkDetailResponse["work"], "meta" | "slug">;
};

const PUBLIC_WORK_SEGMENT = "w";
const MAX_NAME_LENGTH = 72;
const MAX_SHORT_NAME_LENGTH = 24;
const WORK_SUFFIX = "Cohub Work";

export type PublicWorkPath = {
	username: string;
	spaceSlug: string;
	workSlug: string;
	pathname: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown) {
	if (typeof value !== "string") return null;
	const text = value.replace(/\s+/g, " ").trim();
	return text || null;
}

function truncateText(value: string, maxLength: number) {
	if (value.length <= maxLength) return value;
	return `${value.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function humanizeSlug(value: string) {
	return value
		.split(/[-_]+/)
		.filter(Boolean)
		.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
		.join(" ")
		.trim();
}

function workMetaTitle(meta: WorkMeta | null | undefined) {
	if (!isRecord(meta)) return null;
	return cleanText(meta.title) ?? cleanText(meta.name);
}

export function parsePublicWorkPath(pathname: string): PublicWorkPath | null {
	const segments = pathname.split("/").filter(Boolean);
	if (segments.length !== 4 || segments[2] !== PUBLIC_WORK_SEGMENT) return null;
	const [username, spaceSlug, , workSlug] = segments;
	if (!username || !spaceSlug || !workSlug) return null;
	return { username, spaceSlug, workSlug, pathname: `/${segments.join("/")}` };
}

export function resolvePublicWorkStartUrl(requestUrl: URL) {
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

export function buildWorkPwaMeta(detail: WorkPwaDetail | null) {
	const work = detail?.work ?? null;
	const space = detail?.space ?? null;
	const primaryName =
		workMetaTitle(work?.meta) ??
		cleanText(space?.name) ??
		(work?.slug ? humanizeSlug(work.slug) : null) ??
		"Work";
	const shortName = truncateText(primaryName, MAX_SHORT_NAME_LENGTH);
	const name = truncateText(`${primaryName} — ${WORK_SUFFIX}`, MAX_NAME_LENGTH);
	const description = space?.name
		? `Open ${primaryName} from ${space.name}`
		: "Open a Cohub Work directly";

	return { name, shortName, description };
}
