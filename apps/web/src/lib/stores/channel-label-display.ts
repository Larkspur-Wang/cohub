import type { Channel } from "@neta-art/cohub";
import { sdk } from "$lib/sdk";

export type ChannelLabelInfo = {
	id: string;
	provider: string;
	name: string;
};

/** Positive hits stay until refresh; misses only suppress refetch briefly. */
const MISS_TTL_MS = 60_000;

const byId = new Map<string, ChannelLabelInfo>();
const missUntil = new Map<string, number>();
const listeners = new Set<() => void>();
let listInflight: Promise<void> | null = null;
let version = 0;

function emit() {
	version += 1;
	for (const listener of listeners) listener();
}

function toInfo(channel: Channel): ChannelLabelInfo {
	return {
		id: channel.id,
		provider: channel.provider,
		name: channel.name,
	};
}

function isFreshMiss(channelId: string) {
	const until = missUntil.get(channelId);
	if (until == null) return false;
	if (until > Date.now()) return true;
	missUntil.delete(channelId);
	return false;
}

function collectMissing(channelIds: string[]) {
	return [
		...new Set(
			channelIds
				.map((value) => value.trim())
				.filter((value) => value && !byId.has(value) && !isFreshMiss(value)),
		),
	];
}

export function fallbackChannelLabelName(channelId: string) {
	return channelId.replaceAll("-", "").slice(0, 8) || "Channel";
}

export function formatChannelLabelName(
	info: ChannelLabelInfo | null | undefined,
	channelId: string,
) {
	const name = info?.name?.trim();
	const provider = info?.provider?.trim();
	if (name && provider) return `${provider} · ${name}`;
	if (name) return name;
	if (provider) return `${provider} · ${fallbackChannelLabelName(channelId)}`;
	return fallbackChannelLabelName(channelId);
}

export function getChannelLabelInfo(channelId: string) {
	return byId.get(channelId) ?? null;
}

export function onChannelLabelDisplayUpdated(handler: () => void) {
	listeners.add(handler);
	return () => listeners.delete(handler);
}

export function getChannelLabelDisplayVersion() {
	return version;
}

async function refreshChannelList(requestedIds: string[]) {
	try {
		const channels = await sdk.channels.list();
		let changed = false;
		const seen = new Set<string>();
		for (const channel of channels) {
			seen.add(channel.id);
			const prev = byId.get(channel.id);
			const next = toInfo(channel);
			if (!prev || prev.name !== next.name || prev.provider !== next.provider) {
				changed = true;
			}
			byId.set(channel.id, next);
			missUntil.delete(channel.id);
		}
		const until = Date.now() + MISS_TTL_MS;
		for (const channelId of requestedIds) {
			if (!seen.has(channelId) && !byId.has(channelId)) {
				missUntil.set(channelId, until);
			}
		}
		if (changed) emit();
	} catch {
		// Do not write misses on failure — retry on next hydrate.
	}
}

export async function hydrateChannelLabels(channelIds: string[]) {
	// Single-flight: wait for any in-flight list, then only fetch if still needed.
	while (true) {
		const missing = collectMissing(channelIds);
		if (missing.length === 0) return;

		if (listInflight) {
			await listInflight;
			continue;
		}

		const task = refreshChannelList(missing).finally(() => {
			listInflight = null;
		});
		listInflight = task;
		await task;
		return;
	}
}
