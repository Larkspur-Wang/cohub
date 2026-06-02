import type { LabelResourceType } from "@neta-art/cohub";
import type { LabelAssignableCohubResource } from "$lib/drag/cohub-resource-drag";
import {
	getAffectedLabelIds,
	getResourceLabels,
	setResourceLabels,
} from "$lib/stores/space-labels";

export type ResourceLabelMutationResult = {
	changed: boolean;
	previousLabelIds: string[];
	nextLabelIds: string[];
	affectedLabelIds: string[];
};

function unique(values: string[]) {
	return Array.from(new Set(values.filter(Boolean)));
}

async function getCurrentLabelIds(
	spaceId: string,
	resourceType: LabelResourceType,
	resourceRef: string,
) {
	const result = await getResourceLabels(spaceId, resourceType, resourceRef);
	return result.assignments.map((assignment) => assignment.labelId);
}

async function applyResourceLabels(input: {
	spaceId: string;
	resource: LabelAssignableCohubResource;
	previousLabelIds: string[];
	nextLabelIds: string[];
}): Promise<ResourceLabelMutationResult> {
	const previousLabelIds = unique(input.previousLabelIds);
	const nextLabelIds = unique(input.nextLabelIds);
	const affectedLabelIds = getAffectedLabelIds(previousLabelIds, nextLabelIds);
	const unchanged =
		previousLabelIds.length === nextLabelIds.length &&
		previousLabelIds.every((labelId) => nextLabelIds.includes(labelId));

	if (unchanged) {
		return {
			changed: false,
			previousLabelIds,
			nextLabelIds,
			affectedLabelIds: [],
		};
	}

	await setResourceLabels(
		input.spaceId,
		input.resource.type,
		input.resource.ref,
		nextLabelIds,
		{ previousLabelIds },
	);

	return {
		changed: true,
		previousLabelIds,
		nextLabelIds,
		affectedLabelIds,
	};
}

export async function addResourceToLabel(input: {
	spaceId: string;
	resource: LabelAssignableCohubResource;
	targetLabelId: string;
}): Promise<ResourceLabelMutationResult> {
	const previousLabelIds = await getCurrentLabelIds(
		input.spaceId,
		input.resource.type,
		input.resource.ref,
	);
	return applyResourceLabels({
		spaceId: input.spaceId,
		resource: input.resource,
		previousLabelIds,
		nextLabelIds: [...previousLabelIds, input.targetLabelId],
	});
}

export async function moveResourceToLabel(input: {
	spaceId: string;
	resource: LabelAssignableCohubResource;
	sourceLabelId: string;
	targetLabelId: string;
}): Promise<ResourceLabelMutationResult> {
	if (input.sourceLabelId === input.targetLabelId) {
		const previousLabelIds = await getCurrentLabelIds(
			input.spaceId,
			input.resource.type,
			input.resource.ref,
		);
		return {
			changed: false,
			previousLabelIds,
			nextLabelIds: previousLabelIds,
			affectedLabelIds: [],
		};
	}

	const previousLabelIds = await getCurrentLabelIds(
		input.spaceId,
		input.resource.type,
		input.resource.ref,
	);
	return applyResourceLabels({
		spaceId: input.spaceId,
		resource: input.resource,
		previousLabelIds,
		nextLabelIds: [
			...previousLabelIds.filter((labelId) => labelId !== input.sourceLabelId),
			input.targetLabelId,
		],
	});
}

export async function removeResourceFromLabel(input: {
	spaceId: string;
	resource: LabelAssignableCohubResource;
	sourceLabelId: string;
}): Promise<ResourceLabelMutationResult> {
	const previousLabelIds = await getCurrentLabelIds(
		input.spaceId,
		input.resource.type,
		input.resource.ref,
	);
	return applyResourceLabels({
		spaceId: input.spaceId,
		resource: input.resource,
		previousLabelIds,
		nextLabelIds: previousLabelIds.filter(
			(labelId) => labelId !== input.sourceLabelId,
		),
	});
}
