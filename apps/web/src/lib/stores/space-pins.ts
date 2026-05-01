import type { SpaceMarkListItem, SpaceMarkResourceType } from "@neta-art/cohub";
import { sdk } from "$lib/sdk";
import {
	fetchSpacePinsWithCache,
	getCachedSpacePins,
	patchCachedSpacePins,
	setCachedSpacePins,
} from "$lib/stores/space-marks-cache";

export type SpacePinResourceType = SpaceMarkResourceType;

export type ToggleSpacePinInput = {
	spaceId: string;
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

export async function getSpacePinsForMutation(spaceId: string) {
	const cached = getCachedSpacePins(spaceId);
	if (cached) return cached;
	try {
		return await fetchSpacePins(spaceId);
	} catch {
		return [];
	}
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
	const currentPins = await getSpacePinsForMutation(spaceId);
	const currentPin = findSpacePin(currentPins, resourceType, resourceRef);

	if (currentPin) {
		await sdk.space(spaceId).marks.delete(currentPin.id);
		const next = patchCachedSpacePins(spaceId, (items) =>
			items.filter((item) => item.id !== currentPin.id),
		);
		notifySpacePinsUpdated(spaceId);
		return next;
	}

	const result = await sdk.space(spaceId).marks.create({
		resourceType,
		resourceRef,
		label,
	});
	const next = setCachedSpacePins(spaceId, [...currentPins, result.mark]);
	notifySpacePinsUpdated(spaceId);
	return next;
}
