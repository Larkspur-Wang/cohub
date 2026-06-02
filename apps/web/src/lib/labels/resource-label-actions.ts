import type { LabelResourceType } from "@neta-art/cohub";
import type { LabelAssignableCohubResource } from "$lib/drag/cohub-resource-drag";
import {
	getLabelIdsByRefs,
	getLabelRefsFromAssignments,
	getResourceLabels,
	setResourceLabels,
} from "$lib/stores/space-labels";

export type ResourceLabelMutationResult = {
	changed: boolean;
	previousLabelRefs: string[];
	nextLabelRefs: string[];
	affectedLabelIds: string[];
};

function unique(values: string[]) {
	return Array.from(new Set(values.filter(Boolean)));
}

async function getCurrentLabels(
	spaceId: string,
	resourceType: LabelResourceType,
	resourceRef: string,
) {
	const result = await getResourceLabels(spaceId, resourceType, resourceRef);
	return {
		refs: getLabelRefsFromAssignments(result.labels, result.assignments),
		labels: result.labels,
	};
}

async function applyResourceLabels(input: {
	spaceId: string;
	resource: LabelAssignableCohubResource;
	previousLabelRefs: string[];
	nextLabelRefs: string[];
}): Promise<ResourceLabelMutationResult> {
	const previousLabelRefs = unique(input.previousLabelRefs);
	const nextLabelRefs = unique(input.nextLabelRefs);
	const affectedRefs = unique([...previousLabelRefs, ...nextLabelRefs]);
	const unchanged =
		previousLabelRefs.length === nextLabelRefs.length &&
		previousLabelRefs.every((labelRef) => nextLabelRefs.includes(labelRef));

	if (unchanged) {
		return {
			changed: false,
			previousLabelRefs,
			nextLabelRefs,
			affectedLabelIds: [],
		};
	}

	await setResourceLabels(
		input.spaceId,
		input.resource.type,
		input.resource.ref,
		nextLabelRefs,
		{ previousLabelRefs },
	);

	const latest = await getResourceLabels(
		input.spaceId,
		input.resource.type,
		input.resource.ref,
	);
	return {
		changed: true,
		previousLabelRefs,
		nextLabelRefs,
		affectedLabelIds: getLabelIdsByRefs(latest.labels, affectedRefs),
	};
}

export async function addResourceToLabel(input: {
	spaceId: string;
	resource: LabelAssignableCohubResource;
	targetLabelRef: string;
}): Promise<ResourceLabelMutationResult> {
	const current = await getCurrentLabels(
		input.spaceId,
		input.resource.type,
		input.resource.ref,
	);
	return applyResourceLabels({
		spaceId: input.spaceId,
		resource: input.resource,
		previousLabelRefs: current.refs,
		nextLabelRefs: [...current.refs, input.targetLabelRef],
	});
}

export async function moveResourceToLabel(input: {
	spaceId: string;
	resource: LabelAssignableCohubResource;
	sourceLabelRef: string;
	targetLabelRef: string;
}): Promise<ResourceLabelMutationResult> {
	const current = await getCurrentLabels(
		input.spaceId,
		input.resource.type,
		input.resource.ref,
	);
	if (input.sourceLabelRef === input.targetLabelRef) {
		return {
			changed: false,
			previousLabelRefs: current.refs,
			nextLabelRefs: current.refs,
			affectedLabelIds: [],
		};
	}
	return applyResourceLabels({
		spaceId: input.spaceId,
		resource: input.resource,
		previousLabelRefs: current.refs,
		nextLabelRefs: [
			...current.refs.filter((labelRef) => labelRef !== input.sourceLabelRef),
			input.targetLabelRef,
		],
	});
}

export async function removeResourceFromLabel(input: {
	spaceId: string;
	resource: LabelAssignableCohubResource;
	sourceLabelRef: string;
}): Promise<ResourceLabelMutationResult> {
	const current = await getCurrentLabels(
		input.spaceId,
		input.resource.type,
		input.resource.ref,
	);
	return applyResourceLabels({
		spaceId: input.spaceId,
		resource: input.resource,
		previousLabelRefs: current.refs,
		nextLabelRefs: current.refs.filter(
			(labelRef) => labelRef !== input.sourceLabelRef,
		),
	});
}
