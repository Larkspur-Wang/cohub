import type { UserProfile } from "@neta-art/cohub";

export type SpaceMention = {
	type: "space";
	spaceId: string;
	label: string;
	uri: string;
	href: string;
};

export type SpaceMentionSuggestion = {
	type: "space";
	id: string;
	spaceId: string;
	name: string;
	description: string | null;
	ownerProfile: Pick<
		UserProfile,
		"userUuid" | "displayName" | "avatarUrl"
	> | null;
	href: string;
	uri: string;
	updatedAt: string | null;
	source: "local" | "remote" | "local+remote";
	score: number;
	textScore: number;
	recencyScore: number;
};

const SPACE_URI_PREFIX = "cohub://spaces/";
const SPACE_MENTION_PATTERN = /@\[([^\]\n]+)\]\(cohub:\/\/spaces\/([^)\s]+)\)/g;
const SPACE_URL_PATTERN =
	/(?:(?:https?:\/\/(?:dev\.)?cohub\.run)|(?:https?:\/\/localhost(?::\d+)?))?\/spaces\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:[/?#][^\s)\]]*)?/g;

function safeDecode(value: string) {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function escapeMentionLabel(label: string) {
	return label
		.replace(/[[\]\\]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

export function buildSpaceMentionUri(spaceId: string) {
	return `${SPACE_URI_PREFIX}${encodeURIComponent(spaceId)}`;
}

export function buildSpaceMentionHref(spaceId: string) {
	return `/spaces/${encodeURIComponent(spaceId)}`;
}

export function buildSpaceMentionMarkdown(input: {
	spaceId: string;
	label: string;
}) {
	const label =
		escapeMentionLabel(input.label) || `space:${input.spaceId.slice(0, 8)}`;
	return `@[${label}](${buildSpaceMentionUri(input.spaceId)})`;
}

export function parseSpaceMentionUri(uri: string): { spaceId: string } | null {
	if (!uri.startsWith(SPACE_URI_PREFIX)) return null;
	const spaceId = safeDecode(uri.slice(SPACE_URI_PREFIX.length)).trim();
	if (!spaceId) return null;
	return { spaceId };
}

export function extractSpaceMentionsFromText(text: string): SpaceMention[] {
	const mentions: SpaceMention[] = [];
	const seen = new Set<string>();
	for (const match of text.matchAll(SPACE_MENTION_PATTERN)) {
		const label = match[1]?.trim();
		const spaceId = safeDecode(match[2] ?? "").trim();
		if (!label || !spaceId || seen.has(spaceId)) continue;
		seen.add(spaceId);
		mentions.push({
			type: "space",
			spaceId,
			label,
			uri: buildSpaceMentionUri(spaceId),
			href: buildSpaceMentionHref(spaceId),
		});
	}
	return mentions;
}

export function parseCohubSpaceUrls(
	value: string,
	maxMatches = 20,
): Array<{ raw: string; spaceId: string }> {
	const matches: Array<{ raw: string; spaceId: string }> = [];
	for (const match of value.matchAll(SPACE_URL_PATTERN)) {
		const raw = match[0];
		const spaceId = match[1]?.trim();
		if (!raw || !spaceId) continue;
		matches.push({ raw, spaceId });
		if (matches.length >= maxMatches) break;
	}
	return matches;
}

export function replaceCohubSpaceUrls(
	value: string,
	resolveLabel: (spaceId: string) => string | null | undefined,
) {
	return value.replace(SPACE_URL_PATTERN, (_raw, spaceId: string) => {
		const label = resolveLabel(spaceId) ?? `space:${spaceId.slice(0, 8)}`;
		return buildSpaceMentionMarkdown({ spaceId, label });
	});
}
