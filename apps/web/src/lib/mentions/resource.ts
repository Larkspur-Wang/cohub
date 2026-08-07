import {
	buildSpaceMentionHref,
	buildSpaceMentionUri,
	type ParsedCohubSpaceLink,
	parseSpaceMentionUri,
	replaceCohubSpaceUrls,
} from "./space";
import {
	buildWorkMentionHref,
	buildWorkMentionUri,
	type ParsedCohubWorkLink,
	parseWorkMentionUri,
	replaceCohubWorkUrls,
} from "./work";

export type ResourceMentionTextToken =
	| { type: "text"; text: string }
	| {
			type: "spaceMention";
			label: string;
			spaceId: string;
			sessionId?: string;
			raw: string;
			uri: string;
			href: string;
	  }
	| {
			type: "workMention";
			label: string;
			username: string;
			spaceSlug: string;
			workSlug: string;
			launchSuffix: string;
			raw: string;
			uri: string;
			href: string;
	  };

const RESOURCE_MENTION_PATTERN =
	/@\[([^\]\n]+)\]\((cohub:\/\/(?:spaces|works)\/[^\s)]+)\)/g;
const VALID_MENTION_PREFIX_PATTERN = /[\s([{<:,;!?，。！？、；：]/;

function isMentionBoundary(text: string, index: number) {
	return index <= 0 || VALID_MENTION_PREFIX_PATTERN.test(text[index - 1] ?? "");
}

export function tokenizeResourceMentionText(
	text: string,
): ResourceMentionTextToken[] {
	if (!text) return [];
	const tokens: ResourceMentionTextToken[] = [];
	let cursor = 0;
	for (const match of text.matchAll(RESOURCE_MENTION_PATTERN)) {
		const raw = match[0] ?? "";
		const index = match.index ?? 0;
		if (!isMentionBoundary(text, index)) continue;
		if (index > cursor)
			tokens.push({ type: "text", text: text.slice(cursor, index) });

		const label = match[1]?.trim() ?? "";
		const uri = match[2] ?? "";
		const space = parseSpaceMentionUri(uri);
		const work = parseWorkMentionUri(uri);
		if (!raw || !label || (!space && !work)) {
			tokens.push({ type: "text", text: raw });
		} else if (space) {
			tokens.push({
				type: "spaceMention",
				label,
				spaceId: space.spaceId,
				...(space.sessionId ? { sessionId: space.sessionId } : {}),
				raw,
				uri: buildSpaceMentionUri(space.spaceId, space.sessionId),
				href: buildSpaceMentionHref(space.spaceId, space.sessionId),
			});
		} else if (work) {
			tokens.push({
				type: "workMention",
				label,
				...work,
				raw,
				uri: buildWorkMentionUri(work),
				href: buildWorkMentionHref(work),
			});
		}
		cursor = index + raw.length;
	}
	if (cursor < text.length)
		tokens.push({ type: "text", text: text.slice(cursor) });
	return tokens;
}

export function formatResourceMentionTextForDisplay(text: string) {
	return tokenizeResourceMentionText(text)
		.map((token) => (token.type === "text" ? token.text : `@${token.label}`))
		.join("");
}

export function replaceCohubResourceUrls(
	text: string,
	resolve: {
		space: (link: ParsedCohubSpaceLink) => string | null | undefined;
		work: (link: ParsedCohubWorkLink) => string | null | undefined;
	},
) {
	return replaceCohubWorkUrls(
		replaceCohubSpaceUrls(text, resolve.space),
		resolve.work,
	);
}
