import type { SpaceMarkListItem, SpaceMarkResourceType } from "@neta-art/cohub";
import { sdk } from "$lib/sdk";
import {
	fetchSpacePinsWithCache,
	getCachedSpacePins,
	patchCachedSpacePins,
	setCachedSpacePins,
} from "$lib/stores/space-marks-cache";

export type SpacePinResourceType = SpaceMarkResourceType;

export type SpacePinScope = string;
export const GLOBAL_SPACE_PIN_SCOPE = "00000000-0000-4000-8000-000000000000";

export type ToggleSpacePinInput = {
	spaceId?: string;
	resourceType: SpacePinResourceType;
	resourceRef: string;
	label?: string | null;
};

export function isSpacePin(
	marks: SpaceMarkListItem[],
	resourceType: SpacePinResourceType,
	resourceRef: string,
) {
	return marks.some(
		(mark) =>
			mark.resourceType === resourceType && mark.resourceRef === resourceRef,
	);
}

export function findSpacePin(
	marks: SpaceMarkListItem[],
	resourceType: SpacePinResourceType,
	resourceRef: string,
) {
	return marks.find(
		(mark) =>
			mark.resourceType === resourceType && mark.resourceRef === resourceRef,
	);
}

function getPinScope(
	spaceId: string | undefined,
	resourceType: SpacePinResourceType,
) {
	return resourceType === "space" ? GLOBAL_SPACE_PIN_SCOPE : spaceId;
}

function requirePinScope(scope: SpacePinScope | undefined) {
	if (!scope) throw new Error("spaceId is required for this pin resource");
	return scope;
}

export function getPinnedFilePaths(marks: SpaceMarkListItem[]) {
	return new Set(
		marks
			.filter((mark) => mark.resourceType === "file")
			.map((mark) => mark.resourceRef),
	);
}

export async function fetchSpacePins(spaceId: string, force = false) {
	return fetchSpacePinsWithCache(
		spaceId,
		async () => {
			const result = await sdk.space(spaceId).marks.list("pin");
			return result.marks ?? [];
		},
		{ force },
	);
}

export async function fetchGlobalSpacePins(force = false) {
	return fetchSpacePins(GLOBAL_SPACE_PIN_SCOPE, force);
}

export async function getSpacePinsForMutation(
	spaceId: string | undefined,
	resourceType: SpacePinResourceType,
) {
	const scope = requirePinScope(getPinScope(spaceId, resourceType));
	const cached = getCachedSpacePins(scope);
	if (cached) return cached;
	return fetchSpacePins(scope);
}

export function notifySpacePinsUpdated(spaceId: string) {
	if (typeof window === "undefined") return;
	window.dispatchEvent(
		new CustomEvent("cohub:marks-updated", { detail: { spaceId } }),
	);
}

export async function toggleSpacePin({
	spaceId,
	resourceType,
	resourceRef,
	label = null,
}: ToggleSpacePinInput): Promise<SpaceMarkListItem[]> {
	const scope = requirePinScope(getPinScope(spaceId, resourceType));
	const currentPins = await getSpacePinsForMutation(spaceId, resourceType);
	const currentPin = findSpacePin(currentPins, resourceType, resourceRef);

	if (currentPin) {
		await sdk.space(scope).marks.delete(currentPin.id);
		const next = patchCachedSpacePins(scope, (items) =>
			items.filter((item) => item.id !== currentPin.id),
		);
		notifySpacePinsUpdated(scope);
		return next;
	}

	const result = await sdk.space(scope).marks.create({
		resourceType,
		resourceRef,
		label,
	});
	const next = setCachedSpacePins(scope, [...currentPins, result.mark]);
	notifySpacePinsUpdated(scope);
	return next;
}
