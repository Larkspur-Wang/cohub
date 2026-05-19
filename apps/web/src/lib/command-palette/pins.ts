import type { SpaceMarkListItem } from "@neta-art/cohub";
import { getCachedSpaceList } from "$lib/stores/space-list-cache";
import { getCachedSpacePins } from "$lib/stores/space-marks-cache";
import {
	fetchGlobalSpacePins,
	fetchSpacePins,
	GLOBAL_SPACE_PIN_SCOPE,
} from "$lib/stores/space-pins";
import { textMatchScore } from "./score";
import type { CommandPaletteItem, PinInfo } from "./types";

export type PinIndex = Map<string, PinInfo>;

type PinnableItem = Pick<
	CommandPaletteItem,
	"type" | "spaceId" | "sessionId" | "turnId" | "id"
>;

function commandItemPinKey(item: PinnableItem) {
	if (item.type === "space") return `space:${item.spaceId}`;
	if (item.type === "session") return `session:${item.sessionId ?? item.id}`;
	return null;
}

export function pinInfoForItem(pins: PinIndex, item: PinnableItem) {
	const key = commandItemPinKey(item);
	return key ? pins.get(key) : undefined;
}

export function applyPinInfoToItems<T extends CommandPaletteItem>(
	items: T[],
	pins: PinIndex,
): T[] {
	return items.map((item) => {
		const pin = pinInfoForItem(pins, item);
		return pin
			? { ...item, isPinned: true, pin }
			: { ...item, isPinned: false, pin: undefined };
	});
}

function pinInfoFromMark(mark: SpaceMarkListItem): PinInfo | null {
	if (mark.resourceType !== "space" && mark.resourceType !== "session")
		return null;
	return {
		markId: mark.id,
		scopeSpaceId: mark.spaceId,
		resourceType: mark.resourceType,
		resourceRef: mark.resourceRef,
		rank: mark.rank,
	};
}

export function buildPinIndex(marks: SpaceMarkListItem[]) {
	const pins: PinIndex = new Map();
	for (const mark of marks) {
		const pin = pinInfoFromMark(mark);
		if (!pin) continue;
		pins.set(
			mark.resourceType === "space"
				? `space:${mark.resourceRef}`
				: `session:${mark.resourceRef}`,
			pin,
		);
	}
	return pins;
}

function compactText(value: string | null | undefined, limit: number) {
	const text = (value ?? "").replace(/\s+/g, " ").trim();
	if (!text) return null;
	return text.length > limit
		? `${text.slice(0, Math.max(0, limit - 1))}…`
		: text;
}

function markToPinnedItem(
	mark: SpaceMarkListItem,
	index: number,
): CommandPaletteItem | null {
	const baseScore = Math.max(0.2, 1 - index * 0.015);
	const updatedAt = mark.updatedAt ?? null;
	if (mark.resourceType === "space") {
		const space = getCachedSpaceList()?.find(
			(item) => item.id === mark.resourceRef,
		);
		const title =
			mark.resource?.title ?? mark.label ?? space?.name ?? "Untitled space";
		return {
			type: "space",
			id: mark.resourceRef,
			spaceId: mark.resourceRef,
			sessionId: null,
			turnId: null,
			sequence: null,
			title,
			excerpt: compactText(mark.resource?.subtitle ?? space?.description, 220),
			spaceName: title,
			ownerProfile: space?.ownerProfile ?? null,
			sessionTitle: null,
			matchedField: "name",
			href: mark.href,
			score: 0.96 * baseScore,
			textScore: 0.96,
			recencyScore: 0.7,
			typePriorityScore: 0.96,
			updatedAt,
			source: "default",
			isPinned: true,
			pin: {
				markId: mark.id,
				scopeSpaceId: mark.spaceId,
				resourceType: "space",
				resourceRef: mark.resourceRef,
				rank: mark.rank,
			},
		};
	}
	if (mark.resourceType !== "session") return null;
	const title = mark.resource?.title ?? mark.label ?? "Untitled session";
	return {
		type: "session",
		id: mark.resourceRef,
		spaceId: mark.spaceId,
		sessionId: mark.resourceRef,
		turnId: null,
		sequence: null,
		title,
		excerpt: null,
		spaceName: null,
		sessionTitle: title,
		matchedField: "title",
		href: mark.href,
		score: 0.9 * baseScore,
		textScore: 0.9,
		recencyScore: 0.65,
		typePriorityScore: 0.82,
		updatedAt,
		source: "default",
		isPinned: true,
		pin: {
			markId: mark.id,
			scopeSpaceId: mark.spaceId,
			resourceType: "session",
			resourceRef: mark.resourceRef,
			rank: mark.rank,
		},
	};
}

function matchesPinnedQuery(item: CommandPaletteItem, query: string) {
	const trimmed = query.trim();
	if (!trimmed) return true;
	return (
		Math.max(
			textMatchScore(item.title, trimmed),
			textMatchScore(item.excerpt, trimmed),
			textMatchScore(item.spaceName, trimmed),
			textMatchScore(item.sessionTitle, trimmed),
		) > 0
	);
}

export async function getPinnedCommandItems(input: {
	query: string;
	currentSpaceId?: string | null;
	signal?: AbortSignal;
	force?: boolean;
}) {
	if (input.signal?.aborted)
		throw new DOMException("Pinned items aborted", "AbortError");
	const [globalPins, currentSpacePins] = await Promise.all([
		fetchGlobalSpacePins(input.force),
		input.currentSpaceId && input.currentSpaceId !== GLOBAL_SPACE_PIN_SCOPE
			? fetchSpacePins(input.currentSpaceId, input.force)
			: Promise.resolve([]),
	]);
	if (input.signal?.aborted)
		throw new DOMException("Pinned items aborted", "AbortError");
	return [...globalPins, ...currentSpacePins]
		.map(markToPinnedItem)
		.filter((item): item is CommandPaletteItem => Boolean(item))
		.filter((item) => matchesPinnedQuery(item, input.query));
}

export function getCachedCommandPalettePins(currentSpaceId?: string | null) {
	return buildPinIndex([
		...(getCachedSpacePins(GLOBAL_SPACE_PIN_SCOPE) ?? []),
		...(currentSpaceId && currentSpaceId !== GLOBAL_SPACE_PIN_SCOPE
			? (getCachedSpacePins(currentSpaceId) ?? [])
			: []),
	]);
}
