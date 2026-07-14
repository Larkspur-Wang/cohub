export type SpaceMentionTrigger = {
	start: number;
	end: number;
	query: string;
};

export type TextCaret = {
	start: number;
	end: number;
};

export const SPACE_MENTION_TRIGGER_SCAN_LIMIT = 96;

/**
 * Detect an active `@mention` trigger from text + caret.
 * Pure: no DOM reads. Callers own caret sync for Safari timing.
 */
export function detectSpaceMentionTriggerFromText(
	text: string,
	caret: TextCaret,
	options?: { scanLimit?: number },
): SpaceMentionTrigger | null {
	const cursor = caret.start;
	if (cursor !== caret.end) return null;
	if (cursor < 0 || cursor > text.length) return null;

	const scanLimit = options?.scanLimit ?? SPACE_MENTION_TRIGGER_SCAN_LIMIT;
	const scanStart = Math.max(0, cursor - scanLimit);
	const prefix = text.slice(scanStart, cursor);
	const match = /(^|\s)@([^@\s[\]()]{0,80})$/.exec(prefix);
	if (!match) return null;

	const token = match[2] ?? "";
	const atIndex = cursor - token.length - 1;
	if (atIndex < 0) return null;
	if (atIndex > 0 && !/\s/.test(text[atIndex - 1] ?? "")) return null;

	return { start: atIndex, end: cursor, query: token };
}

/** Identity for dismiss tracking: one @ occurrence (by caret start of `@`). */
export function spaceMentionTriggerKey(trigger: SpaceMentionTrigger): string {
	return String(trigger.start);
}
