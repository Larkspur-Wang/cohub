<script lang="ts">
import type {
	LabelAssignmentRecord,
	LabelListItem,
	LabelResourceType,
} from "@neta-art/cohub";
import { Check, ChevronDown, Loader2, Plus, X } from "lucide-svelte";
import {
	createSpaceLabel,
	flattenLabels,
	flattenLabelsWithRefs,
	getResourceLabels,
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
let loading = $state(true);
let saving = $state(false);
let error = $state("");
let showCreate = $state(false);
let newLabelName = $state("");
let newLabelParentId = $state("");
let createSaving = $state(false);

const flatLabels = $derived(flattenLabels(labels));
const labelOptions = $derived(flattenLabelsWithRefs(labels));
const rootLabels = $derived(flatLabels.filter((label) => label.depth === 0));

async function load() {
	loading = true;
	error = "";
	try {
		const result = await getResourceLabels(spaceId, resourceType, resourceRef);
		labels = result.labels;
		assignments = result.assignments;
		const refsById = new Map(
			flattenLabelsWithRefs(result.labels).map((label) => [
				label.id,
				label.ref,
			]),
		);
		selected = new Set(
			result.assignments
				.map((assignment) => refsById.get(assignment.labelId))
				.filter((ref): ref is string => Boolean(ref)),
		);
	} catch (err) {
		console.warn("[labels] Failed to load resource labels", err);
		error = "Labels unavailable";
	} finally {
		loading = false;
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
		labels = result.labels;
		assignments = result.assignments;
		onClose();
	} catch (err) {
		console.warn("[labels] Failed to save resource labels", err);
		error = "Could not save labels";
	} finally {
		saving = false;
	}
}

async function createLabel() {
	const name = newLabelName.replace(/\s+/g, " ").trim();
	if (!name || createSaving) return;
	createSaving = true;
	error = "";
	try {
		const parentRef = newLabelParentId
			? flattenLabelsWithRefs(labels).find(
					(label) => label.id === newLabelParentId,
				)?.ref
			: null;
		const label = await createSpaceLabel(
			spaceId,
			parentRef ? `${parentRef}/${name}` : name,
		);
		const result = await getResourceLabels(spaceId, resourceType, resourceRef);
		labels = result.labels;
		assignments = result.assignments;
		if (label) {
			const createdRef = flattenLabelsWithRefs(result.labels).find(
				(item) => item.id === label.id,
			)?.ref;
			if (createdRef) selected = new Set([...selected, createdRef]);
		}
		newLabelName = "";
		newLabelParentId = "";
		showCreate = false;
	} catch (err) {
		console.warn("[labels] Failed to create label", err);
		error = "Could not create label";
	} finally {
		createSaving = false;
	}
}

$effect(() => {
	spaceId;
	resourceType;
	resourceRef;
	void load();
});
</script>

<div class="fixed inset-0 z-[80]" role="presentation" onclick={onClose}></div>
<div
	class="label-picker fixed right-4 top-16 z-[81] w-[min(360px,calc(100vw-24px))] overflow-hidden rounded-lg border border-border-subtle bg-bg-primary shadow-xl"
	role="dialog"
	aria-label="Label as"
>
	<div class="flex items-center justify-between border-b border-border-subtle px-3 py-2">
		<div>
			<div class="text-[13px] font-medium text-text-primary">Label as</div>
			<div class="mt-0.5 text-[11px] text-text-tertiary">Choose labels for this item.</div>
		</div>
		<button type="button" class="rounded-[5px] p-1 text-text-tertiary hover:bg-bg-hover hover:text-text-primary" onclick={onClose} aria-label="Close">
			<X class="h-3.5 w-3.5" />
		</button>
	</div>

	<div class="max-h-[360px] overflow-y-auto px-2 py-2">
		{#if loading}
			<div class="flex items-center gap-2 px-2 py-4 text-[12px] text-text-tertiary">
				<Loader2 class="h-3.5 w-3.5 animate-spin" /> Loading labels…
			</div>
		{:else if flatLabels.length === 0 && !showCreate}
			<div class="px-2 py-5 text-[12px] text-text-tertiary">
				<div class="font-medium text-text-secondary">No labels yet</div>
				<div class="mt-1">Create one to group chats, files, and saves.</div>
			</div>
		{:else}
			<div class="space-y-[1px]">
				{#each labels as label (label.id)}
					{@const labelRef = labelOptions.find((item) => item.id === label.id)?.ref ?? label.name}
					<label class="label-row">
						<input type="checkbox" checked={selected.has(labelRef)} onchange={() => toggleLabel(labelRef)} />
						<span>{label.name}</span>
					</label>
					{#each label.children ?? [] as child (child.id)}
						{@const childRef = labelOptions.find((item) => item.id === child.id)?.ref ?? `${labelRef}/${child.name}`}
						<label class="label-row child">
							<input type="checkbox" checked={selected.has(childRef)} onchange={() => toggleLabel(childRef)} />
							<span>{child.name}</span>
						</label>
					{/each}
				{/each}
			</div>
		{/if}

		{#if showCreate}
			<div class="mt-2 rounded-md border border-border-subtle bg-bg-secondary p-2">
				<label class="block text-[11px] text-text-tertiary" for="new-resource-label-name">Label name</label>
				<input
					id="new-resource-label-name"
					class="mt-1 w-full rounded-[5px] border border-border-subtle bg-bg-input px-2 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand"
					bind:value={newLabelName}
					maxlength="80"
					placeholder="New label"
				/>
				<label class="mt-2 block text-[11px] text-text-tertiary" for="new-resource-label-parent">Nest label under</label>
				<div class="relative mt-1">
					<select
						id="new-resource-label-parent"
						class="w-full appearance-none rounded-[5px] border border-border-subtle bg-bg-input px-2 py-1.5 pr-7 text-[13px] text-text-primary outline-none focus:border-brand"
						bind:value={newLabelParentId}
					>
						<option value="">None</option>
						{#each rootLabels as label (label.id)}
							<option value={label.id}>{label.name}</option>
						{/each}
					</select>
					<ChevronDown class="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary" />
				</div>
				<div class="mt-2 flex items-center justify-end gap-1.5">
					<button type="button" class="btn-ghost" onclick={() => { showCreate = false; newLabelName = ""; newLabelParentId = ""; }}>Cancel</button>
					<button type="button" class="btn-primary" disabled={!newLabelName.trim() || createSaving} onclick={() => void createLabel()}>
						{#if createSaving}<Loader2 class="h-3 w-3 animate-spin" />{:else}<Plus class="h-3 w-3" />{/if}
						Create
					</button>
				</div>
			</div>
		{/if}
	</div>

	{#if error}
		<div class="border-t border-border-subtle px-3 py-2 text-[12px] text-error-soft">{error}</div>
	{/if}

	<div class="flex items-center justify-between border-t border-border-subtle px-3 py-2">
		<button type="button" class="inline-flex items-center gap-1.5 rounded-[5px] px-2 py-1.5 text-[12px] text-text-tertiary hover:bg-bg-hover hover:text-text-secondary" onclick={() => { showCreate = !showCreate; }}>
			<Plus class="h-3.5 w-3.5" /> New label
		</button>
		<button type="button" class="btn-primary" disabled={saving || loading} onclick={() => void save()}>
			{#if saving}<Loader2 class="h-3 w-3 animate-spin" />{:else}<Check class="h-3 w-3" />{/if}
			Apply
		</button>
	</div>
</div>

<style>
	.label-picker {
		max-height: min(72vh, 560px);
	}

	.label-row {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 30px;
		border-radius: 6px;
		padding: 0 8px;
		color: var(--text-secondary);
		font-size: 13px;
		cursor: pointer;
	}

	.label-row:hover { background: var(--bg-hover); color: var(--text-primary); }
	.label-row.child { padding-left: 26px; color: var(--text-tertiary); }
	.label-row input { accent-color: var(--brand); }

	.btn-primary,
	.btn-ghost {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		border-radius: 5px;
		padding: 6px 9px;
		font-size: 12px;
		line-height: 1;
		transition: background-color 100ms ease, color 100ms ease, opacity 100ms ease;
	}

	.btn-primary {
		background: var(--brand);
		color: var(--brand-contrast-fg);
	}

	.btn-primary:disabled { opacity: 0.55; }
	.btn-ghost { color: var(--text-tertiary); }
	.btn-ghost:hover { background: var(--bg-hover); color: var(--text-secondary); }

	@media (max-width: 640px) {
		.label-picker {
			top: auto;
			right: 8px;
			bottom: 8px;
			left: 8px;
			width: auto;
			max-height: 78vh;
			border-radius: 14px;
		}

		.label-row {
			min-height: 42px;
			font-size: 14px;
		}
	}
</style>
