import type {
	BoardComposition,
	BoardProceduralClip,
	BoardTrack,
} from "@cohub/protocol";
import { boardJsonEquals } from "./json-equals.js";

/**
 * Row-level diff for composition re-apply.
 *
 * A `composition.apply` carries the full aggregate, but the write should only
 * touch what actually changed: re-applying an identical or mostly-identical
 * composition must not rewrite (or even re-serialize) every track and clip row.
 * The comparison lives next to the row mappers in Core so the API (live writes)
 * and any future consumer share one definition of "unchanged".
 */

/** Whether a track row already reflects this authored track. */
export function boardTrackUnchanged(
	existing: {
		id: string;
		channel: string;
		channelVersion: number;
		interpolation: string;
		fill: string;
		target: unknown;
		keyframes: unknown;
		metadata: unknown;
	},
	track: BoardTrack,
): boolean {
	return (
		existing.id === track.id &&
		existing.channel === track.channel &&
		existing.channelVersion === track.channelVersion &&
		existing.interpolation === track.interpolation &&
		existing.fill === track.fill &&
		boardJsonEquals(existing.target, track.target) &&
		boardJsonEquals(existing.keyframes, track.keyframes) &&
		boardJsonEquals(existing.metadata, track.metadata)
	);
}

/** Whether a clip row already reflects this authored clip. */
export function boardClipUnchanged(
	existing: {
		id: string;
		kind: string;
		kindVersion: number;
		target: unknown;
		start: number;
		duration: number;
		layer: string;
		fill: string;
		easing: string | null;
		params: unknown;
		assetRefs: unknown;
		seed: string;
		metadata: unknown;
	},
	clip: BoardProceduralClip,
): boolean {
	return (
		existing.id === clip.id &&
		existing.kind === clip.kind &&
		existing.kindVersion === clip.kindVersion &&
		existing.start === clip.start &&
		existing.duration === clip.duration &&
		existing.layer === clip.layer &&
		existing.fill === clip.fill &&
		existing.easing === clip.easing &&
		boardJsonEquals(existing.target, clip.target) &&
		boardJsonEquals(existing.params, clip.params) &&
		boardJsonEquals(existing.assetRefs, clip.assetRefs) &&
		existing.seed === clip.seed &&
		boardJsonEquals(existing.metadata, clip.metadata)
	);
}

/** Whether the composition header row (everything but tracks/clips) changed. */
export function boardCompositionHeaderUnchanged(
	existing: {
		name: string;
		duration: number;
		playback: unknown;
		markers: unknown;
		metadata: unknown;
	},
	composition: Omit<BoardComposition, "revision">,
): boolean {
	return (
		existing.name === composition.name &&
		existing.duration === composition.timeline.duration &&
		boardJsonEquals(existing.playback, composition.playback) &&
		boardJsonEquals(existing.markers, composition.timeline.markers) &&
		boardJsonEquals(existing.metadata, composition.metadata)
	);
}

/** Row-level plan for one composition.apply. */
export type BoardCompositionWritePlan = {
	/** Track ids present before but absent from the incoming aggregate. */
	removedTrackIds: string[];
	/** Clip ids present before but absent from the incoming aggregate. */
	removedClipIds: string[];
	/** Authored tracks that are new or whose row differs. */
	changedTracks: BoardTrack[];
	/** Authored clips that are new or whose row differs. */
	changedClips: BoardProceduralClip[];
	/** Whether any part of the aggregate differs from the stored rows. */
	changed: boolean;
};

export function diffBoardCompositionWrite(
	previous: {
		name: string;
		duration: number;
		playback: unknown;
		markers: unknown;
		metadata: unknown;
	} | null,
	previousTracks: ReadonlyArray<Parameters<typeof boardTrackUnchanged>[0]>,
	previousClips: ReadonlyArray<Parameters<typeof boardClipUnchanged>[0]>,
	next: Omit<BoardComposition, "revision">,
): BoardCompositionWritePlan {
	const previousTracksById = new Map(previousTracks.map((track) => [track.id, track]));
	const previousClipsById = new Map(previousClips.map((clip) => [clip.id, clip]));
	const nextTrackIds = new Set(next.timeline.tracks.map((track) => track.id));
	const nextClipIds = new Set(next.timeline.clips.map((clip) => clip.id));
	const removedTrackIds = previousTracks
		.filter((track) => !nextTrackIds.has(track.id))
		.map((track) => track.id);
	const removedClipIds = previousClips
		.filter((clip) => !nextClipIds.has(clip.id))
		.map((clip) => clip.id);
	const changedTracks = next.timeline.tracks.filter((track) => {
		const existing = previousTracksById.get(track.id);
		return !existing || !boardTrackUnchanged(existing, track);
	});
	const changedClips = next.timeline.clips.filter((clip) => {
		const existing = previousClipsById.get(clip.id);
		return !existing || !boardClipUnchanged(existing, clip);
	});
	const headerChanged = !previous || !boardCompositionHeaderUnchanged(previous, next);
	return {
		removedTrackIds,
		removedClipIds,
		changedTracks,
		changedClips,
		changed: headerChanged ||
			removedTrackIds.length > 0 ||
			removedClipIds.length > 0 ||
			changedTracks.length > 0 ||
			changedClips.length > 0,
	};
}
