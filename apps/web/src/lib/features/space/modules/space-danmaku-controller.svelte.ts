// Space danmaku controller — a restrained, lane-based queue for floating
// other users' messages across the workspace.
//
// Design goals:
//   - Zero footprint when idle (the layer unmounts when items is empty).
//   - Bounded concurrency + per-user throttle + dedup, so bursts never flood.
//   - Pure CSS animation (GPU transform), no layout thrash.
//
// Data source: `session.turn.created` realtime events (user messages only),
// already filtered to "other users" + "not the active session" by the caller.

export type DanmakuItem = {
	id: string;
	text: string;
	sessionId: string;
	authorName: string;
	avatarUrl: string | null;
	lane: number;
	durationMs: number;
};

export type DanmakuPushInput = {
	id: string;
	text: string;
	sessionId: string;
	userUuid: string;
	authorName: string;
	avatarUrl: string | null;
};

// ─── Tuning ──────────────────────────────────────────────────────────
// Conservative defaults — the feature should hint at activity, never demand
// attention.
const DESKTOP_LANES = 5;
const MOBILE_LANES = 3;
const DESKTOP_DURATION_MS = 9000;
const MOBILE_DURATION_MS = 7000;
const MAX_VISIBLE = 8; // hard cap of items on screen at once
const THROTTLE_MS = 1500; // min gap between shown items per user
const LANE_GAP_MS = 250; // extra spacing before reusing a lane
const TEXT_LIMIT = 120;
const DEDUP_MAX = 256;
const CHAR_PX = 9; // rough avg glyph width for lane timing estimation
const AVATAR_PX = 64; // avatar + horizontal padding estimate

function isMobileViewport(): boolean {
	return (
		typeof window !== "undefined" &&
		window.matchMedia("(max-width: 640px)").matches
	);
}

function viewportWidth(): number {
	return (typeof window !== "undefined" ? window.innerWidth : 0) || 1200;
}

function estimateItemWidth(text: string): number {
	return Math.min(text.length, TEXT_LIMIT) * CHAR_PX + AVATAR_PX;
}

function truncate(text: string): string {
	const trimmed = text.replace(/\s+/g, " ").trim();
	if (!trimmed) return "";
	return trimmed.length > TEXT_LIMIT
		? `${trimmed.slice(0, TEXT_LIMIT)}…`
		: trimmed;
}

/**
 * Extract a short, human-readable preview from a `session.turn.created`
 * turn payload. Falls back to neutral labels for non-text content so the
 * danmaku never shows raw URLs or empty pills.
 */
export function extractDanmakuText(turn: unknown): string {
	if (!turn || typeof turn !== "object") return "";
	const t = turn as { userText?: unknown; userContent?: unknown };

	const content = Array.isArray(t.userContent) ? t.userContent : null;
	if (content) {
		const textBlock = content.find(
			(b): b is { type: "text"; text: string } =>
				!!b &&
				typeof b === "object" &&
				(b as { type?: unknown }).type === "text",
		);
		if (
			textBlock &&
			typeof textBlock.text === "string" &&
			textBlock.text.trim()
		) {
			return textBlock.text.trim();
		}
		const typeOf = (b: unknown) =>
			!!b && typeof b === "object" && (b as { type?: unknown }).type;
		if (content.some((b) => typeOf(b) === "image")) return "Sent an image";
		if (content.some((b) => typeOf(b) === "shell_command"))
			return "Sent a command";
	}

	const text = typeof t.userText === "string" ? t.userText.trim() : "";
	if (!text) return "";
	// A bare URL with no surrounding text is usually a media/link attachment.
	if (/^https?:\/\/\S+$/.test(text)) return "Sent a link";
	return text;
}

export function createSpaceDanmakuController() {
	let items = $state<DanmakuItem[]>([]);
	const laneNextAvailable = Array.from(
		{ length: Math.max(DESKTOP_LANES, MOBILE_LANES) },
		() => 0,
	);
	const lastShownPerUser = new Map<string, number>();
	const seenIds: string[] = [];
	const seenSet = new Set<string>();
	const timers = new Map<string, ReturnType<typeof setTimeout>>();

	function dismiss(id: string) {
		items = items.filter((it) => it.id !== id);
		timers.delete(id);
	}

	function clear() {
		for (const timer of timers.values()) clearTimeout(timer);
		timers.clear();
		items = [];
	}

	function push(input: DanmakuPushInput) {
		// 1. Dedup — never show the same turn twice (also guards WS recovery
		//    replays).
		if (seenSet.has(input.id)) return;
		seenSet.add(input.id);
		seenIds.push(input.id);
		if (seenIds.length > DEDUP_MAX) {
			const oldest = seenIds.shift();
			if (oldest) seenSet.delete(oldest);
		}

		// 2. Per-user throttle — anchor to last *shown* time so a steady
		//    discussion produces a calm trickle rather than a flood.
		const now = Date.now();
		const lastShown = lastShownPerUser.get(input.userUuid) ?? 0;
		if (now - lastShown < THROTTLE_MS) return;

		// 3. Capacity — drop new items once the screen is full (restraint).
		if (items.length >= MAX_VISIBLE) return;

		const text = truncate(input.text);
		if (!text) return;

		// 4. Lane assignment — pick the earliest-available lane; if every
		//    lane is still occupied, drop the item rather than overlap.
		const mobile = isMobileViewport();
		const laneCount = mobile ? MOBILE_LANES : DESKTOP_LANES;
		const duration = mobile ? MOBILE_DURATION_MS : DESKTOP_DURATION_MS;

		let bestLane = 0;
		let bestTime = laneNextAvailable[0];
		for (let i = 1; i < laneCount; i++) {
			if (laneNextAvailable[i] < bestTime) {
				bestTime = laneNextAvailable[i];
				bestLane = i;
			}
		}
		if (bestTime > now) return; // all lanes busy → drop for restraint

		// 5. Commit — reserve the lane for long enough that this item's tail
		//    clears the right edge before the lane is reused.
		const width = viewportWidth();
		const itemWidth = estimateItemWidth(text);
		const speed = (width + itemWidth) / duration; // px / ms
		const enterTime = itemWidth / speed; // ms for tail to clear right edge
		laneNextAvailable[bestLane] = now + enterTime + LANE_GAP_MS;
		lastShownPerUser.set(input.userUuid, now);

		const item: DanmakuItem = {
			id: input.id,
			text,
			sessionId: input.sessionId,
			authorName: input.authorName,
			avatarUrl: input.avatarUrl,
			lane: bestLane,
			durationMs: duration,
		};
		items = [...items, item];

		const timer = setTimeout(() => dismiss(input.id), duration + 200);
		timers.set(input.id, timer);
	}

	function dispose() {
		clear();
		seenSet.clear();
		seenIds.length = 0;
		lastShownPerUser.clear();
		laneNextAvailable.fill(0);
	}

	return {
		get items() {
			return items;
		},
		push,
		clear,
		dispose,
	};
}

export type SpaceDanmakuController = ReturnType<
	typeof createSpaceDanmakuController
>;
