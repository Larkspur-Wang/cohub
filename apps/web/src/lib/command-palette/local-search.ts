import type { SessionTurnRecord } from "@cohub/protocol/model";
import type { SessionRecord, SpaceRecord } from "@neta-art/cohub";
import {
	idbGetAllByIndex,
	type SessionListCacheRecord,
	type SessionTurnsCacheRecord,
	type SpaceRecordCacheRecord,
} from "$lib/cache/db";
import { getCacheUserKey } from "$lib/cache/keys";
import { getSpacePublicProfile } from "$lib/space-profile";
import { getCachedSpaceList } from "$lib/stores/space-list-cache";
import { commandItemKey } from "./merge-results";
import { allowsResourceType, type CommandPaletteSearchPlan } from "./scope";
import { scoreCommandItem, sortCommandItems, textMatchScore } from "./score";
import type { CommandPaletteItem } from "./types";

const LOCAL_LIMIT = 40;

function hrefFor(
	item: Pick<CommandPaletteItem, "type" | "spaceId" | "sessionId" | "sequence">,
) {
	if (item.type === "space") return `/spaces/${item.spaceId}`;
	if (item.type === "session")
		return `/spaces/${item.spaceId}/sessions/${item.sessionId}`;
	return `/spaces/${item.spaceId}/sessions/${item.sessionId}?turn=${item.sequence}`;
}

function compactText(value: string | null | undefined, limit: number) {
	const text = (value ?? "").replace(/\s+/g, " ").trim();
	if (!text) return null;
	return text.length > limit
		? `${text.slice(0, Math.max(0, limit - 1))}…`
		: text;
}

function spaceToItem(
	space: SpaceRecord,
	query: string,
): CommandPaletteItem | null {
	const nameScore = textMatchScore(space.name, query);
	const descriptionScore = textMatchScore(space.description, query);
	if (Math.max(nameScore, descriptionScore) <= 0) return null;
	const matchedField = nameScore >= descriptionScore ? "name" : "description";
	const scored = scoreCommandItem({
		type: "space",
		query,
		primary: matchedField === "name" ? space.name : space.description,
		secondary: matchedField === "name" ? space.description : space.name,
		matchedField,
		updatedAt: space.updatedAt,
	});
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
		ownerProfile: space.ownerProfile ?? null,
		spaceProfile: getSpacePublicProfile(space),
		sessionTitle: null,
		matchedField,
		href: `/spaces/${space.id}`,
		updatedAt: space.updatedAt ?? null,
		source: "local",
		localScore: scored.score,
		...scored,
	};
}

function sessionToItem(input: {
	session: SessionRecord;
	spaceName: string | null;
	query: string;
}): CommandPaletteItem | null {
	const title = input.session.title || "Untitled session";
	if (textMatchScore(title, input.query) <= 0) return null;
	const updatedAt =
		input.session.lastMessageAt ??
		input.session.updatedAt ??
		input.session.createdAt ??
		null;
	const scored = scoreCommandItem({
		type: "session",
		query: input.query,
		primary: title,
		matchedField: "title",
		updatedAt,
	});
	return {
		type: "session",
		id: input.session.id,
		spaceId: input.session.spaceId,
		sessionId: input.session.id,
		turnId: null,
		sequence: null,
		title,
		excerpt: null,
		spaceName: input.spaceName,
		sessionTitle: title,
		matchedField: "title",
		href: `/spaces/${input.session.spaceId}/sessions/${input.session.id}`,
		updatedAt,
		source: "local",
		localScore: scored.score,
		...scored,
	};
}

function turnToItem(input: {
	turn: SessionTurnRecord;
	session: SessionRecord | null;
	spaceId: string;
	spaceName: string | null;
	query: string;
}): CommandPaletteItem | null {
	const text = input.turn.userText ?? "";
	if (textMatchScore(text, input.query) <= 0) return null;
	const updatedAt = input.turn.updatedAt ?? input.turn.createdAt ?? null;
	const scored = scoreCommandItem({
		type: "turn",
		query: input.query,
		primary: text,
		matchedField: "userText",
		updatedAt,
	});
	return {
		type: "turn",
		id: input.turn.id,
		spaceId: input.spaceId,
		sessionId: input.turn.sessionId,
		turnId: input.turn.id,
		sequence: input.turn.sequence,
		title: compactText(text, 140) ?? "User message",
		excerpt: compactText(text, 260),
		spaceName: input.spaceName,
		sessionTitle: input.session?.title ?? null,
		matchedField: "userText",
		href: hrefFor({
			type: "turn",
			spaceId: input.spaceId,
			sessionId: input.turn.sessionId,
			sequence: input.turn.sequence,
		}),
		updatedAt,
		source: "local",
		localScore: scored.score,
		...scored,
	};
}

function shouldAbort(signal?: AbortSignal) {
	if (signal?.aborted) throw new DOMException("Search aborted", "AbortError");
}

async function yieldToUi() {
	await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

export async function searchLocalCommandItems(
	query: string,
	options?: {
		signal?: AbortSignal;
		resourceTypes?: CommandPaletteSearchPlan["resourceTypes"];
	},
): Promise<CommandPaletteItem[]> {
	const normalized = query.trim();
	if (normalized.length < 2) return [];
	const plan: CommandPaletteSearchPlan = {
		query: normalized,
		resourceTypes: options?.resourceTypes,
	};
	const includeSpaces = allowsResourceType(plan, "space");
	const includeSessions = allowsResourceType(plan, "session");
	const includeTurns = allowsResourceType(plan, "turn");
	const userKey = getCacheUserKey();
	const spacesById = new Map<string, SpaceRecord>();
	const items: CommandPaletteItem[] = [];

	for (const space of getCachedSpaceList() ?? []) {
		spacesById.set(space.id, space);
		if (includeSpaces) {
			const item = spaceToItem(space, normalized);
			if (item) items.push(item);
		}
	}

	const spaceRecords = await idbGetAllByIndex<SpaceRecordCacheRecord>(
		"space_records",
		"by_updated_at",
		IDBKeyRange.lowerBound(0),
	);
	shouldAbort(options?.signal);
	for (const record of spaceRecords) {
		if (record.userKey !== userKey) continue;
		spacesById.set(record.spaceId, record.space);
		if (includeSpaces) {
			const item = spaceToItem(record.space, normalized);
			if (item) items.push(item);
		}
	}

	const sessionLists = await idbGetAllByIndex<SessionListCacheRecord>(
		"session_lists",
		"by_updated_at",
		IDBKeyRange.lowerBound(0),
	);
	shouldAbort(options?.signal);
	const sessionsById = new Map<string, SessionRecord>();
	let processed = 0;
	for (const record of sessionLists) {
		if (record.userKey !== userKey) continue;
		const spaceName = spacesById.get(record.spaceId)?.name ?? null;
		for (const session of record.sessions) {
			sessionsById.set(session.id, session);
			if (includeSessions) {
				const item = sessionToItem({ session, spaceName, query: normalized });
				if (item) items.push(item);
			}
		}
		processed += 1;
		if (processed % 10 === 0) {
			shouldAbort(options?.signal);
			await yieldToUi();
		}
	}

	if (!includeTurns) {
		const byKey = new Map<string, CommandPaletteItem>();
		for (const item of items) {
			const key = commandItemKey(item);
			const existing = byKey.get(key);
			if (!existing || item.score > existing.score) byKey.set(key, item);
		}
		return sortCommandItems([...byKey.values()]).slice(0, LOCAL_LIMIT);
	}

	const turnRecords = await idbGetAllByIndex<SessionTurnsCacheRecord>(
		"session_turns",
		"by_last_accessed",
		IDBKeyRange.lowerBound(0),
	);
	shouldAbort(options?.signal);
	processed = 0;
	for (const record of turnRecords) {
		if (record.userKey !== userKey) continue;
		const spaceName = spacesById.get(record.spaceId)?.name ?? null;
		const session =
			record.session ?? sessionsById.get(record.sessionId) ?? null;
		for (const turn of record.turns) {
			const item = turnToItem({
				turn,
				session,
				spaceId: record.spaceId,
				spaceName,
				query: normalized,
			});
			if (item) items.push(item);
		}
		processed += 1;
		if (processed % 6 === 0) {
			shouldAbort(options?.signal);
			await yieldToUi();
		}
	}

	const byKey = new Map<string, CommandPaletteItem>();
	for (const item of items) {
		const key = commandItemKey(item);
		const existing = byKey.get(key);
		if (!existing || item.score > existing.score) byKey.set(key, item);
	}
	return sortCommandItems([...byKey.values()]).slice(0, LOCAL_LIMIT);
}
