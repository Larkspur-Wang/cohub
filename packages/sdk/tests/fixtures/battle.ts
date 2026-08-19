import type { BoardEffect, BoardNodeInput } from "@cohub/protocol";
import { compileComposition } from "../../src/board/animation.js";

export function createBattleFixture(input: {
	leftImagePath: string;
	rightImagePath: string;
	seed?: string;
	autoplayDelay?: number;
}) {
	const seed = input.seed ?? "cohub-battle-v2";
	const nodes: BoardNodeInput[] = [
		{
			nodeId: "fighter-left", type: "image", parentId: null, orderKey: "00000001",
			x: -360, y: -140, width: 280, height: 280, rotation: 0,
			refKind: "space_file", refPath: input.leftImagePath, refUrl: null,
			view: {}, style: {}, data: {},
		},
		{
			nodeId: "fighter-right", type: "image", parentId: null, orderKey: "00000002",
			x: 80, y: -140, width: 280, height: 280, rotation: 0,
			refKind: "space_file", refPath: input.rightImagePath, refUrl: null,
			view: {}, style: {}, data: {},
		},
		{
			nodeId: "battle-title", type: "text", parentId: null, orderKey: "00000003",
			x: -170, y: 190, width: 340, height: 72, rotation: 0,
			refKind: null, refPath: null, refUrl: null,
			view: {}, style: {}, data: { text: "FINAL IMPACT", color: "brand", fontSize: 48 },
		},
	];
	const effects: Array<Omit<BoardEffect, "boardId" | "revision">> = [
		{
			id: "left-pulse", target: { type: "item", itemId: "fighter-left" },
			kind: "effects.pulse", kindVersion: 1, enabled: true,
			lifecycle: "when-visible", timeOrigin: "visible", layer: "behind",
			seed: `${seed}:left-pulse`, params: { amount: 0.025, period: 1800 },
			assetRefs: [], metadata: {},
		},
	];
	const composition = compileComposition({
		id: "battle",
		name: "Battle",
		duration: 2_100,
		tracks: [
			{
				id: "left-motion", target: { type: "item", itemId: "fighter-left" },
				channel: "transform.translation", interpolation: "linear", fill: "both",
				keyframes: [
					{ time: 0, value: { x: 0, y: 0 } },
					{ time: 580, value: { x: 170, y: 0 }, easing: "ease-in-out-cubic" },
					{ time: 900, value: { x: 0, y: 0 } },
				],
			},
			{
				id: "right-motion", target: { type: "item", itemId: "fighter-right" },
				channel: "transform.translation", interpolation: "linear", fill: "both",
				keyframes: [
					{ time: 0, value: { x: 0, y: 0 } },
					{ time: 580, value: { x: -170, y: 0 }, easing: "ease-in-out-cubic" },
					{ time: 900, value: { x: 0, y: 0 } },
				],
			},
		],
		clips: [
			{
				id: "impact", kind: "effects.impact", target: { type: "board" },
				start: 900, duration: 520, layer: "front", seed: `${seed}:impact`,
				params: { radius: 180 },
			},
			{
				id: "particles", kind: "effects.particles", target: { type: "board" },
				start: 900, duration: 900, layer: "front", seed: `${seed}:particles`,
				params: { count: 420, bounds: { x: -240, y: -220, width: 480, height: 440 } },
			},
			{
				id: "title", kind: "text.reveal", target: { type: "item", itemId: "battle-title" },
				start: 1_500, duration: 500, fill: "both", seed: `${seed}:title`,
			},
		],
		playback: { loop: true, endBehavior: "hold", reducedMotion: { mode: "base" } },
		metadata: { fixture: "battle-v2" },
	});
	return {
		metadata: { playback: { compositionId: composition.id, delayMs: input.autoplayDelay ?? 0 } },
		nodes,
		effects,
		composition,
		clips: composition.timeline.clips,
	};
}
