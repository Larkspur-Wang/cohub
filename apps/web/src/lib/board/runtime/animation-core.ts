import type {
	BoardComposition,
	BoardPlaybackSnapshot,
	BoardProceduralClip,
} from "@neta-art/cohub";
import { sampleCompositionTracks } from "@neta-art/cohub/board";

export type AnimationPoseValue = Partial<{
	x: number;
	y: number;
	scale: number;
	scaleX: number;
	scaleY: number;
	rotation: number;
	alpha: number;
}>;

export type AnimationPose = {
	x: number;
	y: number;
	scaleX: number;
	scaleY: number;
	rotation: number;
	alpha: number;
};

export type ClipSample = {
	localTime: number;
	progress: number;
	boundary: "before" | "active" | "after";
};

const finite = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

export const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export function ease(name: string, value: number): number {
	const t = clamp01(value);
	switch (name) {
		case "ease-in-quad":
			return t * t;
		case "ease-out-quad":
			return 1 - (1 - t) ** 2;
		case "ease-in-out-quad":
			return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
		case "ease-in-cubic":
			return t ** 3;
		case "ease-out-cubic":
			return 1 - (1 - t) ** 3;
		case "ease-in-out-cubic":
			return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
		case "ease-out-quart":
			return 1 - (1 - t) ** 4;
		case "ease-out-expo":
			return t === 1 ? 1 : 1 - 2 ** (-10 * t);
		default:
			return t;
	}
}

export function clipSampleAt(
	clip: BoardProceduralClip,
	position: number,
): ClipSample | null {
	if (position < clip.start) {
		if (clip.fill !== "backwards" && clip.fill !== "both") return null;
		return { localTime: 0, progress: 0, boundary: "before" };
	}
	const end = clip.start + clip.duration;
	if (position > end) {
		if (clip.fill !== "forwards" && clip.fill !== "both") return null;
		return { localTime: clip.duration, progress: 1, boundary: "after" };
	}
	const localTime = Math.max(0, Math.min(clip.duration, position - clip.start));
	return {
		localTime,
		progress: ease(clip.easing, localTime / clip.duration),
		boundary: "active",
	};
}

type PathPoint = { x: number; y: number };

function pathPoints(value: unknown): PathPoint[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((point) => {
		if (!point || typeof point !== "object" || Array.isArray(point)) return [];
		const { x, y } = point as Record<string, unknown>;
		return finite(x) && finite(y) ? [{ x, y }] : [];
	});
}

export function samplePathPose(
	clip: BoardProceduralClip,
	localTime: number,
): AnimationPoseValue | null {
	const points = pathPoints(clip.params.points);
	if (points.length < 2) return null;
	const lengths = [0];
	for (let index = 1; index < points.length; index += 1) {
		lengths.push(
			(lengths[index - 1] ?? 0) +
				Math.hypot(
					(points[index]?.x ?? 0) - (points[index - 1]?.x ?? 0),
					(points[index]?.y ?? 0) - (points[index - 1]?.y ?? 0),
				),
		);
	}
	const total = lengths.at(-1) ?? 0;
	const first = points[0];
	if (!first) return null;
	if (total <= 0) return { x: first.x, y: first.y };
	const distance = ease(clip.easing, localTime / clip.duration) * total;
	let index = 1;
	while (index < lengths.length - 1 && (lengths[index] ?? 0) < distance)
		index += 1;
	const previous = points[index - 1];
	const next = points[index];
	if (!previous || !next) return null;
	const span = Math.max(
		1e-6,
		(lengths[index] ?? 0) - (lengths[index - 1] ?? 0),
	);
	const progress = clamp01((distance - (lengths[index - 1] ?? 0)) / span);
	const pose: AnimationPoseValue = {
		x: previous.x + (next.x - previous.x) * progress,
		y: previous.y + (next.y - previous.y) * progress,
	};
	if (clip.params.orient === true) {
		pose.rotation = Math.atan2(next.y - previous.y, next.x - previous.x);
	}
	return pose;
}

export const createPose = (): AnimationPose => ({
	x: 0,
	y: 0,
	scaleX: 1,
	scaleY: 1,
	rotation: 0,
	alpha: 1,
});

export function composePose(
	target: AnimationPose,
	value: AnimationPoseValue | null,
): void {
	if (!value) return;
	target.x += value.x ?? 0;
	target.y += value.y ?? 0;
	const scale = value.scale ?? 1;
	target.scaleX *= value.scaleX ?? scale;
	target.scaleY *= value.scaleY ?? scale;
	target.rotation += value.rotation ?? 0;
	target.alpha *= value.alpha ?? 1;
}

export function compositionItemTargetIds(
	composition: BoardComposition,
): Set<string> {
	const ids = new Set<string>();
	for (const track of composition.timeline.tracks) {
		if (track.target.type === "item") ids.add(track.target.itemId);
	}
	for (const clip of composition.timeline.clips) {
		if (clip.target.type === "item") ids.add(clip.target.itemId);
	}
	return ids;
}

export function compositionItemPoses(
	composition: BoardComposition | null,
	time: number,
): Map<string, AnimationPoseValue> {
	const result = new Map<string, AnimationPoseValue>();
	if (!composition) return result;
	for (const sample of sampleCompositionTracks(composition, time)) {
		if (sample.target.type !== "item") continue;
		const pose = result.get(sample.target.itemId) ?? {};
		if (sample.channel === "transform.translation") {
			const value = sample.value as { x?: unknown; y?: unknown };
			if (finite(value?.x)) pose.x = value.x;
			if (finite(value?.y)) pose.y = value.y;
		} else if (
			sample.channel === "transform.rotation" &&
			finite(sample.value)
		) {
			pose.rotation = sample.value;
		} else if (sample.channel === "transform.scale") {
			if (finite(sample.value)) pose.scale = sample.value;
			else if (sample.value && typeof sample.value === "object") {
				const value = sample.value as { x?: unknown; y?: unknown };
				if (finite(value.x)) pose.scaleX = value.x;
				if (finite(value.y)) pose.scaleY = value.y;
			}
		} else if (sample.channel === "style.opacity" && finite(sample.value)) {
			pose.alpha = sample.value;
		}
		result.set(sample.target.itemId, pose);
	}
	return result;
}

export function playbackPosition(
	playback: BoardPlaybackSnapshot,
	now: number,
): number {
	if (playback.status !== "playing" || now < playback.effectiveAt)
		return playback.position;
	return playback.position + (now - playback.effectiveAt) * playback.timeScale;
}

export function timelinePosition(
	position: number,
	duration: number,
	loop: boolean,
): number {
	if (duration <= 0) return 0;
	if (!loop) return Math.min(duration, Math.max(0, position));
	const normalized = position % duration;
	return normalized < 0 ? normalized + duration : normalized;
}

export function playbackSampleAt(
	playback: BoardPlaybackSnapshot,
	duration: number,
	now: number,
	loop = false,
): { position: number; ended: boolean; waiting: boolean } {
	const waiting = playback.status === "playing" && now < playback.effectiveAt;
	const elapsed = playbackPosition(playback, now);
	return {
		position: timelinePosition(elapsed, duration, loop),
		ended: duration <= 0 || (!loop && elapsed >= duration),
		waiting,
	};
}

export function hashUnit(value: string): number {
	let result = 2166136261;
	for (let index = 0; index < value.length; index += 1) {
		result ^= value.charCodeAt(index);
		result = Math.imul(result, 16777619);
	}
	return (result >>> 0) / 0xffffffff;
}
