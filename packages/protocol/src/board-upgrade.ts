import {
	BOARD_PROTOCOL_VERSION,
	BOARD_SNAPSHOT_KIND,
	type BoardSnapshot,
} from "./board.js";

const records = (value: unknown): Array<Record<string, unknown>> =>
	Array.isArray(value)
		? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
		: [];

const targetV2 = (value: unknown) => {
	if (!value || typeof value !== "object" || Array.isArray(value)) return value;
	const target = value as Record<string, unknown>;
	return target.type === "node" && typeof target.nodeId === "string"
		? { type: "item", itemId: target.nodeId }
		: target;
};

/** The single ingress for persisted Board snapshots from earlier protocol versions. */
export function upgradeBoardSnapshot(value: unknown): BoardSnapshot {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Board snapshot must be an object");
	}
	const snapshot = value as Record<string, unknown>;
	if (snapshot.kind !== BOARD_SNAPSHOT_KIND) throw new Error("Invalid Board snapshot kind");
	if (snapshot.version === BOARD_PROTOCOL_VERSION) return snapshot as BoardSnapshot;
	if (snapshot.version !== 1) throw new Error(`Unsupported Board snapshot version: ${String(snapshot.version)}`);

	const clips = records(snapshot.clips);
	const compositions = records(snapshot.sequences).map((sequence) => {
		const id = String(sequence.id);
		return {
			id,
			name: String(sequence.name ?? id),
			timeline: {
				duration: Number(sequence.duration ?? 0),
				tracks: [],
				clips: clips
					.filter((clip) => clip.sequenceId === id)
					.map(({ sequenceId: _sequenceId, keyframes, target, params, ...clip }) => ({
						...clip,
						target: targetV2(target),
						params: Array.isArray(keyframes) && keyframes.length
							? { ...(params as Record<string, unknown> ?? {}), _sourceKeyframes: keyframes }
							: (params ?? {}),
					})),
				markers: [],
			},
			playback: { loop: false, endBehavior: "hold", reducedMotion: { mode: "base" } },
			metadata: {
				...(sequence.metadata as Record<string, unknown> ?? {}),
				_sourceSequence: { seed: sequence.seed, restPose: sequence.restPose },
			},
			revision: Number(sequence.revision ?? 0),
		};
	});
	const effects = records(snapshot.effects).map((effect) => ({
		...effect,
		target: targetV2(effect.target),
	}));
	return {
		...snapshot,
		version: BOARD_PROTOCOL_VERSION,
		effects,
		compositions,
		playback: null,
	} as unknown as BoardSnapshot;
}
