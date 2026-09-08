/**
 * One-shot entrance pose for a node that just landed on the board.
 *
 * Trajectories are hashed from the item id so neighbouring cards don't fall in
 * lockstep. Numbers are deliberately smaller than neta-studio's narrating deal:
 * our cards have no inherent tilt, and dense boards cannot afford a 168px lift.
 */

import {
	type AnimationPose,
	clamp01,
	createPose,
	hashUnit,
} from "./animation-core";

export const ENTRANCE_DURATION_MS = 520;
export const ENTRANCE_LANDING_MS = 600;
export const ENTRANCE_REDUCED_MS = 180;
export const ENTRANCE_TOTAL_MS = ENTRANCE_DURATION_MS + ENTRANCE_LANDING_MS;

/** Reduced motion is a plain fade: no landing highlight, no extra tail. */
export function entranceTotalMs(reducedMotion: boolean): number {
	return reducedMotion ? ENTRANCE_REDUCED_MS : ENTRANCE_TOTAL_MS;
}

const LIFT_PX = 90;
const SWING_X_PX = 48;
const CURVE_Y_PX = 18;
const ROTATE_RAD = (8 * Math.PI) / 180;
const SCALE_START = 0.86;

function easeOutCubic(t: number): number {
	return 1 - (1 - t) ** 3;
}

function easeOutBack(t: number): number {
	const c1 = 1.70158;
	const c3 = c1 + 1;
	return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

export function entranceProgress(
	elapsedMs: number,
	reducedMotion: boolean,
): number {
	const duration = reducedMotion ? ENTRANCE_REDUCED_MS : ENTRANCE_DURATION_MS;
	return clamp01(elapsedMs / duration);
}

export function landingProgress(
	elapsedMs: number,
	reducedMotion = false,
): number {
	if (reducedMotion || elapsedMs < ENTRANCE_DURATION_MS) return 0;
	return 1 - clamp01((elapsedMs - ENTRANCE_DURATION_MS) / ENTRANCE_LANDING_MS);
}

export function entrancePose(
	id: string,
	t: number,
	reducedMotion = false,
): AnimationPose {
	const pose = createPose();
	if (reducedMotion) {
		pose.alpha = easeOutCubic(t);
		return pose;
	}
	const remaining = Math.max(0, 1 - t);
	const enter = easeOutBack(t);
	const swingSign = hashUnit(`${id}:dir`) > 0.5 ? 1 : -1;
	const swing = 0.35 + hashUnit(`${id}:x`) * 0.65;
	const curve = 0.45 + hashUnit(`${id}:curve`) * 0.55;
	const tilt = 0.4 + hashUnit(`${id}:tilt`) * 0.6;
	pose.x = swingSign * SWING_X_PX * swing * remaining ** 0.9;
	pose.y =
		-(remaining * LIFT_PX) -
		CURVE_Y_PX * curve * Math.sin(t * Math.PI) * remaining;
	pose.rotation = swingSign * ROTATE_RAD * tilt * remaining ** 0.85;
	const scale = SCALE_START + (1 - SCALE_START) * enter;
	pose.scaleX = scale;
	pose.scaleY = scale;
	pose.alpha = easeOutCubic(Math.min(1, t / 0.3));
	// Avoid -0 from sign * 0, which fails strict equality in tests and JSON.
	if (pose.x === 0) pose.x = 0;
	if (pose.y === 0) pose.y = 0;
	if (pose.rotation === 0) pose.rotation = 0;
	return pose;
}

export function entranceLandingAlpha(
	elapsedMs: number,
	reducedMotion = false,
): number {
	return landingProgress(elapsedMs, reducedMotion) * 0.85;
}
