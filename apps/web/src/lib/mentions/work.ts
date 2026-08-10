import { parseSpaceSlug, parseUsername } from "@cohub/protocol";

export type WorkMention = {
	type: "work";
	username: string;
	spaceSlug: string;
	workSlug: string;
	label: string;
	uri: string;
	href: string;
};

export type ParsedCohubWorkLink = {
	raw: string;
	username: string;
	spaceSlug: string;
	workSlug: string;
	launchSuffix: string;
};

const WORK_URI_PREFIX = "cohub://works/";
const RESOURCE_PATH_END_PATTERN = "(?![a-z0-9_%/-]|\\.[a-z0-9])";
const COHUB_WORK_LINK_PATTERN = new RegExp(
	`(?:https?:\\/\\/(?:dev\\.)?cohub\\.run|https?:\\/\\/localhost(?::\\d+)?)\\/([a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?)\\/([a-z0-9](?:[a-z0-9_-]{0,78}[a-z0-9])?)\\/w\\/([a-z0-9](?:[a-z0-9_-]{0,78}[a-z0-9])?)((?:[?#][^\\s)\\]]*)?)${RESOURCE_PATH_END_PATTERN}|(^|[\\s([{<:,;!?，。！？、；：])\\/([a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?)\\/([a-z0-9](?:[a-z0-9_-]{0,78}[a-z0-9])?)\\/w\\/([a-z0-9](?:[a-z0-9_-]{0,78}[a-z0-9])?)((?:[?#][^\\s)\\]]*)?)${RESOURCE_PATH_END_PATTERN}`,
	"gi",
);

function safeDecode(value: string) {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function parseWorkIdentity(
	usernameValue: string,
	spaceSlugValue: string,
	workSlugValue: string,
) {
	const username = parseUsername(safeDecode(usernameValue));
	const spaceSlug = parseSpaceSlug(safeDecode(spaceSlugValue));
	const workSlug = parseSpaceSlug(safeDecode(workSlugValue));
	return username && spaceSlug && workSlug
		? { username, spaceSlug, workSlug }
		: null;
}

function escapeMentionLabel(label: string) {
	return label
		.replace(/[[\]\\]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

export function buildWorkMentionUri(input: {
	username: string;
	spaceSlug: string;
	workSlug: string;
	launchSuffix?: string;
}) {
	return `${WORK_URI_PREFIX}${encodeURIComponent(input.username)}/${encodeURIComponent(input.spaceSlug)}/${encodeURIComponent(input.workSlug)}${input.launchSuffix ?? ""}`;
}

export function buildWorkMentionHref(input: {
	username: string;
	spaceSlug: string;
	workSlug: string;
	launchSuffix?: string;
}) {
	return `/${encodeURIComponent(input.username)}/${encodeURIComponent(input.spaceSlug)}/w/${encodeURIComponent(input.workSlug)}${input.launchSuffix ?? ""}`;
}

export function buildWorkMentionMarkdown(input: {
	username: string;
	spaceSlug: string;
	workSlug: string;
	label: string;
	launchSuffix?: string;
}) {
	const label = escapeMentionLabel(input.label) || input.workSlug;
	return `@[${label}](${buildWorkMentionUri(input)})`;
}

export function parseWorkMentionUri(uri: string) {
	if (!uri.startsWith(WORK_URI_PREFIX)) return null;
	const value = uri.slice(WORK_URI_PREFIX.length);
	const suffixIndex = value.search(/[?#]/);
	const path = (suffixIndex >= 0 ? value.slice(0, suffixIndex) : value).split(
		"/",
	);
	if (path.length !== 3) return null;
	const identity = parseWorkIdentity(
		path[0] ?? "",
		path[1] ?? "",
		path[2] ?? "",
	);
	if (!identity) return null;
	return {
		...identity,
		launchSuffix: suffixIndex >= 0 ? value.slice(suffixIndex) : "",
	};
}

export function getCohubWorkLinkKey(
	link: Pick<ParsedCohubWorkLink, "username" | "spaceSlug" | "workSlug">,
) {
	return `${link.username}/${link.spaceSlug}/${link.workSlug}`;
}

export function parseCohubWorkUrls(value: string, maxMatches = 20) {
	const matches: ParsedCohubWorkLink[] = [];
	for (const match of value.matchAll(COHUB_WORK_LINK_PATTERN)) {
		const raw = match[0] ?? "";
		const relativePrefix = match[5] ?? "";
		const identity = parseWorkIdentity(
			match[1] ?? match[6] ?? "",
			match[2] ?? match[7] ?? "",
			match[3] ?? match[8] ?? "",
		);
		const launchSuffix = match[4] ?? match[9] ?? "";
		if (!raw || !identity) continue;
		matches.push({
			raw: raw.slice(relativePrefix.length),
			...identity,
			launchSuffix,
		});
		if (matches.length >= maxMatches) break;
	}
	return matches;
}

export function replaceCohubWorkUrls(
	value: string,
	resolveLabel: (link: ParsedCohubWorkLink) => string | null | undefined,
) {
	return value.replace(
		COHUB_WORK_LINK_PATTERN,
		(
			match,
			absoluteUsername: string,
			absoluteSpaceSlug: string,
			absoluteWorkSlug: string,
			absoluteSuffix: string,
			relativePrefix: string,
			relativeUsername: string,
			relativeSpaceSlug: string,
			relativeWorkSlug: string,
			relativeSuffix: string,
		) => {
			const identity = parseWorkIdentity(
				absoluteUsername || relativeUsername,
				absoluteSpaceSlug || relativeSpaceSlug,
				absoluteWorkSlug || relativeWorkSlug,
			);
			const launchSuffix = absoluteSuffix || relativeSuffix || "";
			if (!identity) return match;
			const link = {
				raw: match.slice((relativePrefix ?? "").length),
				...identity,
				launchSuffix,
			};
			const label = resolveLabel(link);
			if (!label) return match;
			return `${relativePrefix ?? ""}${buildWorkMentionMarkdown({ ...link, label })}`;
		},
	);
}
