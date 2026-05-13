import type { SessionRecord, SpaceRecord } from "@neta-art/cohub";
import type { SessionTurnRecord } from "@neta-art/cohub-protocol/model";
import {
	idbGetAllByIndex,
	type SessionListCacheRecord,
	type SessionTurnsCacheRecord,
	type SpaceRecordCacheRecord,
} from "$lib/cache/db";
import { getCacheUserKey } from "$lib/cache/keys";
import { getRecentSpaces } from "$lib/stores/recent-space";
import { getCachedSpaceList } from "$lib/stores/space-list-cache";
import { getDefaultCommandItems } from "./commands";
import { commandItemKey } from "./merge-results";
import { allowsResourceType, type CommandPaletteSearchPlan } from "./scope";
import { recencyScore } from "./score";
import type { CommandPaletteItem } from "./types";

const DEFAULT_LIMIT = 30;

function compactText(value: string | null | undefined, limit: number) {
	const text = (value ?? "").replace(/\s+/g, " ").trim();
	if (!text) return null;
	return text.length > limit
		? `${text.slice(0, Math.max(0, limit - 1))}…`
		: text;
}

function timeValue(value: string | null | undefined) {
	const time = new Date(value ?? 0).getTime();
	return Number.isFinite(time) ? time : 0;
}

function defaultScore(rank: number, updatedAt: string | null | undefined) {
	const fresh = recencyScore(updatedAt);
	return {
		score: Math.max(0.2, 0.92 - rank * 0.012) * 0.72 + fresh * 0.28,
		textScore: 0,
		recencyScore: fresh,
	};
}

function spaceToDefaultItem(
	space: SpaceRecord,
	rank: number,
	currentSpaceId?: string | null,
): CommandPaletteItem {
	const updatedAt = space.updatedAt ?? null;
	const score = defaultScore(rank, updatedAt);
	return {
		type: "space",
		id: space.id,
		spaceId: space.id,
		sessionId: null,
		turnId: null,
		sequence: null,
		title: space.name ?? "Untitled space",
		excerpt: compactText(space.description, 220),
		spaceName: space.name ?? null,
		sessionTitle: null,
		matchedField: "name",
		href: `/spaces/${space.id}`,
		updatedAt,
		source: "default",
		localScore: score.score,
		typePriorityScore: currentSpaceId === space.id ? 0.93 : 0.88,
		...score,
	};
}

function sessionToDefaultItem(
	session: SessionRecord,
	spaceName: string | null,
	rank: number,
): CommandPaletteItem {
	const title = session.title || "Untitled session";
	const updatedAt =
		session.lastMessageAt ?? session.updatedAt ?? session.createdAt ?? null;
	const score = defaultScore(rank, updatedAt);
	return {
		type: "session",
		id: session.id,
		spaceId: session.spaceId,
		sessionId: session.id,
		turnId: null,
		sequence: null,
		title,
		excerpt: null,
		spaceName,
		sessionTitle: title,
		matchedField: "title",
		href: `/spaces/${session.spaceId}/sessions/${session.id}`,
		updatedAt,
		source: "default",
		localScore: score.score,
		typePriorityScore: 0.74,
		...score,
	};
}

function turnToDefaultItem(input: {
	turn: SessionTurnRecord;
	session: SessionRecord | null;
	spaceId: string;
	spaceName: string | null;
	rank: number;
}): CommandPaletteItem | null {
	const text = input.turn.userText ?? "";
	const title = compactText(text, 140);
	if (!title) return null;
	const updatedAt = input.turn.updatedAt ?? input.turn.createdAt ?? null;
	const score = defaultScore(input.rank, updatedAt);
	return {
		type: "turn",
		id: input.turn.id,
		spaceId: input.spaceId,
		sessionId: input.turn.sessionId,
		turnId: input.turn.id,
		sequence: input.turn.sequence,
		title,
		excerpt: compactText(text, 260),
		spaceName: input.spaceName,
		sessionTitle: input.session?.title ?? null,
		matchedField: "userText",
		href: `/spaces/${input.spaceId}/sessions/${input.turn.sessionId}?turn=${input.turn.sequence}`,
		updatedAt,
		source: "default",
		localScore: score.score,
		typePriorityScore: 0.66,
		...score,
	};
}

function shouldAbort(signal?: AbortSignal) {
	if (signal?.aborted)
		throw new DOMException("Default items aborted", "AbortError");
}

async function yieldToUi() {
	await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

export async function getCommandPaletteDefaultItems(
	plan: CommandPaletteSearchPlan & {
		currentSpaceId?: string | null;
		signal?: AbortSignal;
	},
): Promise<CommandPaletteItem[]> {
	shouldAbort(plan.signal);
	const userKey = getCacheUserKey();
	const spacesById = new Map<string, SpaceRecord>();
	for (const space of getCachedSpaceList() ?? [])
		spacesById.set(space.id, space);

	const spaceRecords = await idbGetAllByIndex<SpaceRecordCacheRecord>(
		"space_records",
		"by_updated_at",
		IDBKeyRange.lowerBound(0),
	);
	shouldAbort(plan.signal);
	for (const record of spaceRecords) {
		if (record.userKey === userKey)
			spacesById.set(record.spaceId, record.space);
	}

	const items: CommandPaletteItem[] = [];

	if (allowsResourceType(plan, "space")) {
		shouldAbort(plan.signal);
		const recentSpaceIds = getRecentSpaces(userKey).map(
			(entry) => entry.spaceId,
		);
		const orderedSpaceIds = [
			...(plan.currentSpaceId ? [plan.currentSpaceId] : []),
			...recentSpaceIds,
			...[...spacesById.values()]
				.sort((a, b) => timeValue(b.updatedAt) - timeValue(a.updatedAt))
				.map((space) => space.id),
		];
		const seen = new Set<string>();
		let rank = 0;
		for (const spaceId of orderedSpaceIds) {
			if (seen.has(spaceId)) continue;
			seen.add(spaceId);
			const space = spacesById.get(spaceId);
			if (!space) continue;
			items.push(spaceToDefaultItem(space, rank, plan.currentSpaceId));
			rank += 1;
		}
	}

	if (allowsResourceType(plan, "session") || allowsResourceType(plan, "turn")) {
		await yieldToUi();
		shouldAbort(plan.signal);
		const sessionLists = await idbGetAllByIndex<SessionListCacheRecord>(
			"session_lists",
			"by_updated_at",
			IDBKeyRange.lowerBound(0),
		);
		shouldAbort(plan.signal);
		const sessionsById = new Map<string, SessionRecord>();
		for (const record of sessionLists) {
			if (record.userKey !== userKey) continue;
			for (const session of record.sessions)
				sessionsById.set(session.id, session);
		}
		if (allowsResourceType(plan, "session")) {
			[...sessionsById.values()]
				.sort(
					(a, b) =>
						timeValue(b.lastMessageAt ?? b.updatedAt ?? b.createdAt) -
						timeValue(a.lastMessageAt ?? a.updatedAt ?? a.createdAt),
				)
				.slice(0, DEFAULT_LIMIT)
				.forEach((session, rank) => {
					items.push(
						sessionToDefaultItem(
							session,
							spacesById.get(session.spaceId)?.name ?? null,
							rank,
						),
					);
				});
		}

		if (allowsResourceType(plan, "turn")) {
			await yieldToUi();
			shouldAbort(plan.signal);
			const turnRecords = await idbGetAllByIndex<SessionTurnsCacheRecord>(
				"session_turns",
				"by_last_accessed",
				IDBKeyRange.lowerBound(0),
			);
			shouldAbort(plan.signal);
			let rank = 0;
			for (const record of turnRecords
				.filter((record) => record.userKey === userKey)
				.sort((a, b) => b.lastAccessedAt - a.lastAccessedAt)) {
				const session =
					record.session ?? sessionsById.get(record.sessionId) ?? null;
				const turns = [...record.turns].sort(
					(a, b) =>
						timeValue(b.updatedAt ?? b.createdAt) -
						timeValue(a.updatedAt ?? a.createdAt),
				);
				for (const turn of turns) {
					const item = turnToDefaultItem({
						turn,
						session,
						spaceId: record.spaceId,
						spaceName: spacesById.get(record.spaceId)?.name ?? null,
						rank,
					});
					if (item) items.push(item);
					rank += 1;
					if (rank >= DEFAULT_LIMIT) break;
				}
				if (rank >= DEFAULT_LIMIT) break;
			}
		}
	}

	items.push(...getDefaultCommandItems(plan));

	const byKey = new Map<string, CommandPaletteItem>();
	for (const item of items) {
		const key = commandItemKey(item);
		if (!byKey.has(key)) byKey.set(key, item);
	}
	return [...byKey.values()]
		.sort((a, b) => b.score - a.score)
		.slice(0, DEFAULT_LIMIT);
}
