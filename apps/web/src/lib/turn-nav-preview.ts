import type { ContentBlock } from "@cohub/protocol/core";
import type {
	SessionTurnAuthorProfile,
	SessionTurnIndexItem,
	SessionTurnIntent,
	SessionTurnRecord,
} from "@cohub/protocol/model";

const IMAGE_ONLY_URL_RE =
	/^(?:https?:\/\/\S+|data:image\/[a-z0-9.+-]+;base64,\S+)$/i;

function imageLabel(count: number) {
	return count === 1 ? "Image" : `${count} images`;
}

function countImages(content: ContentBlock[] | null | undefined) {
	if (!content?.length) return 0;
	return content.reduce(
		(count, block) => count + (block.type === "image" ? 1 : 0),
		0,
	);
}

function normalizeWhitespace(value: string) {
	return value.replace(/\s+/g, " ").trim();
}

function stripLegacyImageUrls(preview: string) {
	const parts = preview
		.split(/\n+/)
		.map((part) => part.trim())
		.filter(Boolean);
	if (parts.length === 0) return "";

	const textParts: string[] = [];
	let imageCount = 0;
	for (const part of parts) {
		if (IMAGE_ONLY_URL_RE.test(part)) {
			imageCount += 1;
			continue;
		}
		textParts.push(part);
	}

	const text = normalizeWhitespace(textParts.join(" "));
	if (imageCount === 0) return text;
	if (!text) return imageLabel(imageCount);
	return `${text} · ${imageLabel(imageCount)}`;
}

function previewFromContent(content: ContentBlock[] | null | undefined) {
	if (!content?.length) return null;
	const parts: string[] = [];
	let imageCount = 0;
	for (const block of content) {
		switch (block.type) {
			case "text": {
				const text = normalizeWhitespace(block.text);
				if (text) parts.push(text);
				break;
			}
			case "image":
				imageCount += 1;
				break;
			case "shell_command":
				parts.push(`$${block.command}`);
				break;
			case "system_note": {
				const text = normalizeWhitespace(block.text);
				if (text) parts.push(text);
				break;
			}
			default:
				break;
		}
	}
	if (imageCount > 0) parts.push(imageLabel(imageCount));
	const preview = normalizeWhitespace(parts.join(" · "));
	return preview || null;
}

export function formatTurnNavPreview(turn: {
	userPreview?: string | null;
	intent?: SessionTurnIntent | null;
	userContent?: ContentBlock[] | null;
}): string {
	if (turn.intent === "compact") return "Context compacted";

	const fromContent = previewFromContent(turn.userContent);
	if (fromContent) return fromContent;

	const raw = turn.userPreview?.trim() ?? "";
	if (!raw) {
		const imageCount = countImages(turn.userContent);
		return imageCount > 0 ? imageLabel(imageCount) : "Empty message";
	}

	return stripLegacyImageUrls(raw) || "Empty message";
}

export function getTurnNavAuthorName(turn: {
	userUuid?: string | null;
	authorProfile?: SessionTurnAuthorProfile | null;
}): string | null {
	const name = turn.authorProfile?.displayName?.trim();
	if (name) return name;
	return null;
}

/** Only show author names when the visible turn list has multiple distinct users. */
export function shouldShowTurnNavAuthors(
	turns: Array<{ userUuid?: string | null }>,
): boolean {
	const uuids = new Set<string>();
	for (const turn of turns) {
		const uuid = turn.userUuid?.trim();
		if (!uuid) continue;
		uuids.add(uuid);
		if (uuids.size >= 2) return true;
	}
	return false;
}

export function turnRecordToIndexItem(
	turn: SessionTurnRecord,
): SessionTurnIndexItem {
	return {
		id: turn.id,
		sessionId: turn.sessionId,
		sourceSessionId: turn.sourceSessionId,
		sourceTurnId: turn.sourceTurnId,
		sequence: turn.sequence,
		status: turn.status,
		intent: turn.intent,
		userUuid: turn.userUuid,
		authorProfile: turn.authorProfile ?? null,
		startedAt: turn.startedAt,
		completedAt: turn.completedAt,
		durationMs: turn.durationMs,
		createdAt: turn.createdAt,
		updatedAt: turn.updatedAt,
		userPreview:
			previewFromContent(turn.userContent) ??
			(turn.userText ? normalizeWhitespace(turn.userText) : null),
		assistantPreview: turn.assistantText
			? normalizeWhitespace(turn.assistantText)
			: null,
		provider: turn.provider,
		model: turn.model,
		finalUsage: turn.finalUsage,
		totalUsage: turn.totalUsage,
		errorMessage: turn.errorMessage,
	};
}

export type TurnNavPreviewSource = {
	intent?: SessionTurnIntent | null;
	userPreview?: string | null;
	userContent?: ContentBlock[] | null;
	userUuid?: string | null;
	authorProfile?: SessionTurnAuthorProfile | null;
};
