<script lang="ts">
import type {
	LabelAssignmentRecord,
	LabelListItem,
	LabelResourceType,
} from "@neta-art/cohub";
import { Check, Loader2, Plus, X } from "lucide-svelte";
import LabelCreateForm from "$lib/components/LabelCreateForm.svelte";
import {
	createSpaceLabel,
	fetchResourceLabelsFresh,
	flattenLabels,
	flattenLabelsWithRefs,
	getCachedResourceLabelsSnapshot,
	getCachedSpaceLabelsSnapshot,
	getResourceLabels,
	onSpaceLabelsCacheUpdated,
	setResourceLabels,
} from "$lib/stores/space-labels";

const {
	spaceId,
	resourceType,
	resourceRef,
	onClose,
}: {
	spaceId: string;
	resourceType: LabelResourceType;
	resourceRef: string;
	onClose: () => void;
} = $props();

let labels = $state<LabelListItem[]>([]);
let assignments = $state<LabelAssignmentRecord[]>([]);
let selected = $state<Set<string>>(new Set());
let saving = $state(false);
let error = $state("");
let showCreate = $state(false);
let initialLoadSettled = $state(false);
let loading = $state(false);
let loadVersion = 0;

const flatLabels = $derived(flattenLabels(labels));
const labelOptions = $derived(flattenLabelsWithRefs(labels));
const selectedCount = $derived(selected.size);

function labelsEqual(a: LabelListItem[], b: LabelListItem[]): boolean {
	if (a === b) return true;
	if (a.length !== b.length) return false;
	return a.every((label, index) => {
		const other = b[index];
		return (
			other &&
			label.id === other.id &&
			label.name === other.name &&
			labelsEqual(label.children ?? [], other.children ?? [])
		);
	});
}

function assignmentRefsEqual(a: Set<string>, b: Set<string>) {
	if (a.size !== b.size) return false;
	for (const value of a) if (!b.has(value)) return false;
	return true;
}

function updateLabels(nextLabels: LabelListItem[]) {
	if (!labelsEqual(labels, nextLabels)) labels = nextLabels;
}

function applyAssignments(
	nextLabels: LabelListItem[],
	nextAssignments: LabelAssignmentRecord[],
) {
	updateLabels(nextLabels);
	assignments = nextAssignments;
	const refsById = new Map(
		flattenLabelsWithRefs(nextLabels).map((label) => [label.id, label.ref]),
	);
	const nextSelected = new Set(
		nextAssignments
			.map((assignment) => refsById.get(assignment.labelId))
			.filter((ref): ref is string => Boolean(ref)),
	);
	if (!assignmentRefsEqual(selected, nextSelected)) selected = nextSelected;
}

async function load() {
	const version = ++loadVersion;
	initialLoadSettled = false;
	loading = true;
	error = "";
	try {
		const [treeCache, assignmentsCache] = await Promise.all([
			getCachedSpaceLabelsSnapshot(spaceId),
			getCachedResourceLabelsSnapshot(spaceId, resourceType, resourceRef),
		]);
		if (version !== loadVersion) return;
		if (treeCache?.labels) updateLabels(treeCache.labels);
		if (assignmentsCache) {
			applyAssignments(assignmentsCache.labels, assignmentsCache.assignments);
			if (!assignmentsCache.stale) return;
		}

		const result = await fetchResourceLabelsFresh(
			spaceId,
			resourceType,
			resourceRef,
		);
		if (version !== loadVersion) return;
		applyAssignments(result.labels, result.assignments);
	} catch (err) {
		if (version !== loadVersion) return;
		console.warn("[labels] Failed to load resource labels", err);
		error = "Labels unavailable";
	} finally {
		if (version === loadVersion) {
			initialLoadSettled = true;
			loading = false;
		}
	}
}

function toggleLabel(labelRef: string) {
	const next = new Set(selected);
	if (next.has(labelRef)) next.delete(labelRef);
	else next.add(labelRef);
	selected = next;
}

async function save() {
	saving = true;
	error = "";
	try {
		const previousLabelRefs = new Set(
			assignments
				.map(
					(assignment) =>
						labelOptions.find((label) => label.id === assignment.labelId)?.ref,
				)
				.filter((ref): ref is string => Boolean(ref)),
		);
		const result = await setResourceLabels(
			spaceId,
			resourceType,
			resourceRef,
			[...selected],
			{ previousLabelRefs: [...previousLabelRefs] },
		);
		updateLabels(result.labels);
		assignments = result.assignments;
		onClose();
	} catch (err) {
		console.warn("[labels] Failed to save resource labels", err);
		error = "Could not save labels";
	} finally {
		saving = false;
	}
}

async function createLabel(input: { name: string; parentRef: string | null }) {
	const label = await createSpaceLabel(
		spaceId,
		input.parentRef ? `${input.parentRef}/${input.name}` : input.name,
	);
	const result = await getResourceLabels(spaceId, resourceType, resourceRef);
	updateLabels(result.labels);
	assignments = result.assignments;
	if (label) {
		const createdRef = flattenLabelsWithRefs(result.labels).find(
			(item) => item.id === label.id,
		)?.ref;
		if (createdRef) selected = new Set([...selected, createdRef]);
	}
	showCreate = false;
}

$effect(() => {
	spaceId;
	resourceType;
	resourceRef;
	void load();
});

$effect(() => {
	const currentSpaceId = spaceId;
	const unsubscribe = onSpaceLabelsCacheUpdated(
		({ spaceId: updatedSpaceId, labels: nextLabels }) => {
			if (updatedSpaceId !== currentSpaceId) return;
			updateLabels(nextLabels);
		},
	);
	return unsubscribe;
});
</script>

<svelte:window onkeydown={(event) => { if (event.key === "Escape") onClose(); }} />

<div class="fixed inset-0 z-[80] bg-overlay-scrim/20" role="presentation" onclick={onClose}></div>
<div
	class="label-picker fixed right-4 top-16 z-[81] w-[min(380px,calc(100vw-24px))] overflow-hidden rounded-lg border border-border-subtle bg-bg-primary shadow-xl"
	role="dialog"
	aria-label="Label as"
>
	<div class="sheet-handle" aria-hidden="true"></div>
	<div class="flex items-start justify-between border-b border-border-subtle px-3 py-2.5">
		<div class="min-w-0">
			<div class="flex min-w-0 items-center gap-1.5">
				<div class="text-[13px] font-medium text-text-primary">Label as</div>
				{#if loading}
					<Loader2 class="h-3 w-3 animate-spin text-text-placeholder" aria-label="Loading labels" />
				{/if}
			</div>
			<div class="mt-0.5 text-[11px] text-text-tertiary">Choose labels for this item.</div>
		</div>
		<button type="button" class="close-button" onclick={onClose} aria-label="Close">
			<X class="h-3.5 w-3.5" />
		</button>
	</div>

	<div class="label-picker-body">
		{#if initialLoadSettled && flatLabels.length === 0 && !showCreate}
			<div class="px-2 py-5 text-[12px] text-text-tertiary">
				<div class="font-medium text-text-secondary">No labels yet</div>
				<div class="mt-1">Create one to group chats, files, and checkpoints.</div>
			</div>
		{:else if flatLabels.length > 0}
			<div class="space-y-[1px]">
				{#each labels as label (label.id)}
					{@const labelRef = labelOptions.find((item) => item.id === label.id)?.ref ?? label.name}
					<label class="label-row">
						<input type="checkbox" checked={selected.has(labelRef)} onchange={() => toggleLabel(labelRef)} />
						<span class="truncate">{label.name}</span>
					</label>
					{#each label.children ?? [] as child (child.id)}
						{@const childRef = labelOptions.find((item) => item.id === child.id)?.ref ?? `${labelRef}/${child.name}`}
						<label class="label-row child">
							<input type="checkbox" checked={selected.has(childRef)} onchange={() => toggleLabel(childRef)} />
							<span class="truncate">{child.name}</span>
						</label>
					{/each}
				{/each}
			</div>
		{/if}

		{#if showCreate}
			<div class="create-panel">
				<LabelCreateForm labels={labels} onSubmit={createLabel} onCancel={() => { showCreate = false; }} autofocus={showCreate} />
			</div>
		{/if}
	</div>

	{#if error}
		<div class="border-t border-border-subtle px-3 py-2 text-[12px] text-error-soft">{error}</div>
	{/if}

	<div class="label-picker-footer">
		<button type="button" class="label-action secondary" onclick={() => { showCreate = !showCreate; }}>
			<Plus class="h-3.5 w-3.5" /> New label
		</button>
		<div class="selected-count" aria-live="polite">{selectedCount} selected</div>
		<button type="button" class="label-action primary" disabled={saving} onclick={() => void save()}>
			{#if saving}<Loader2 class="h-3 w-3 animate-spin" />{:else}<Check class="h-3 w-3" />{/if}
			Apply
		</button>
	</div>
</div>

<style>
	.label-picker {
		max-height: min(74vh, 580px);
		display: flex;
		flex-direction: column;
	}

	.label-picker-body {
		min-height: 0;
		overflow-y: auto;
		padding: 8px;
	}

	.label-row {
		display: flex;
		min-width: 0;
		min-height: 32px;
		align-items: center;
		gap: 8px;
		border-radius: 6px;
		padding: 0 8px;
		color: var(--text-secondary);
		font-size: 13px;
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease;
	}

	.label-row:hover { background: var(--bg-hover); color: var(--text-primary); }
	.label-row.child { padding-left: 28px; color: var(--text-tertiary); }
	.label-row input { flex-shrink: 0; accent-color: var(--brand); }

	.create-panel {
		margin-top: 10px;
		border-top: 1px solid var(--border-subtle);
		padding: 12px 2px 2px;
	}

	.close-button,
	.label-action {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		border-radius: 6px;
		font-size: 12px;
		line-height: 1;
		transition: background-color 120ms ease, color 120ms ease, opacity 120ms ease;
	}

	.close-button {
		min-height: 28px;
		min-width: 28px;
		color: var(--text-tertiary);
	}

	.close-button:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
	}

	.label-picker-footer {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 8px;
		border-top: 1px solid var(--border-subtle);
		padding: 8px 12px;
	}

	.label-action {
		min-height: 32px;
		padding: 7px 10px;
	}

	.label-action.primary {
		background: var(--brand);
		color: var(--brand-contrast-fg);
	}

	.label-action.primary:disabled { opacity: 0.55; }
	.label-action.secondary { color: var(--text-tertiary); }
	.label-action.secondary:hover { background: var(--bg-hover); color: var(--text-secondary); }

	.selected-count {
		color: var(--text-placeholder);
		font-size: 11px;
		text-align: right;
	}

	.sheet-handle {
		display: none;
	}

	@media (max-width: 640px) {
		.label-picker {
			top: auto;
			right: 8px;
			bottom: 8px;
			left: 8px;
			width: auto;
			max-height: min(82dvh, 640px);
			border-radius: 14px;
			padding-bottom: env(safe-area-inset-bottom);
		}

		.sheet-handle {
			display: block;
			margin: 8px auto 2px;
			height: 3px;
			width: 36px;
			border-radius: 999px;
			background: var(--border-strong);
			opacity: 0.75;
		}

		.label-row {
			min-height: 44px;
			font-size: 14px;
		}

		.label-row.child { padding-left: 34px; }

		.close-button,
		.label-action {
			min-height: 44px;
		}

		.close-button {
			min-width: 44px;
		}

		.label-picker-footer {
			grid-template-columns: 1fr 1fr;
			padding: 10px 12px;
		}

		.selected-count {
			display: none;
		}
	}
</style>
