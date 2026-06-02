<script lang="ts">
import type { LabelListItem } from "@neta-art/cohub";
import { ChevronDown, Loader2, Plus, X } from "lucide-svelte";
import { createSpaceLabel, flattenLabels } from "$lib/stores/space-labels";

const {
	spaceId,
	labels,
	onCreated,
	onClose,
}: {
	spaceId: string;
	labels: LabelListItem[];
	onCreated: () => void;
	onClose: () => void;
} = $props();

let name = $state("");
let parentId = $state("");
let saving = $state(false);
let error = $state("");
const rootLabels = $derived(
	flattenLabels(labels).filter((label) => label.depth === 0),
);

async function submit() {
	const trimmed = name.replace(/\s+/g, " ").trim();
	if (!trimmed || saving) return;
	saving = true;
	error = "";
	try {
		await createSpaceLabel(spaceId, {
			name: trimmed,
			parentId: parentId || null,
		});
		onCreated();
		onClose();
	} catch (err) {
		console.warn("[labels] Failed to create label", err);
		error = "Could not create label";
	} finally {
		saving = false;
	}
}
</script>

<div class="fixed inset-0 z-[70]" role="presentation" onclick={onClose}></div>
<div class="new-label-popover fixed left-14 top-28 z-[71] w-[min(320px,calc(100vw-24px))] overflow-hidden rounded-lg border border-border-subtle bg-bg-primary shadow-xl" role="dialog" aria-label="New label">
	<div class="flex items-center justify-between border-b border-border-subtle px-3 py-2">
		<div>
			<div class="text-[13px] font-medium text-text-primary">New label</div>
			<div class="mt-0.5 text-[11px] text-text-tertiary">Create a label for this Space.</div>
		</div>
		<button type="button" class="rounded-[5px] p-1 text-text-tertiary hover:bg-bg-hover hover:text-text-primary" onclick={onClose} aria-label="Close">
			<X class="h-3.5 w-3.5" />
		</button>
	</div>
	<div class="px-3 py-3">
		<label class="block text-[11px] text-text-tertiary" for="label-name">Label name</label>
		<input
			id="label-name"
			class="mt-1 w-full rounded-[5px] border border-border-subtle bg-bg-input px-2 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand"
			bind:value={name}
			maxlength="80"
			placeholder="Label name"
			onkeydown={(event) => { if (event.key === "Enter") void submit(); }}
		/>
		<label class="mt-3 block text-[11px] text-text-tertiary" for="label-parent">Nest label under</label>
		<div class="relative mt-1">
			<select
				id="label-parent"
				class="w-full appearance-none rounded-[5px] border border-border-subtle bg-bg-input px-2 py-1.5 pr-7 text-[13px] text-text-primary outline-none focus:border-brand"
				bind:value={parentId}
			>
				<option value="">None</option>
				{#each rootLabels as label (label.id)}
					<option value={label.id}>{label.name}</option>
				{/each}
			</select>
			<ChevronDown class="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary" />
		</div>
		{#if error}<div class="mt-2 text-[12px] text-error-soft">{error}</div>{/if}
	</div>
	<div class="flex items-center justify-end gap-1.5 border-t border-border-subtle px-3 py-2">
		<button type="button" class="btn-ghost" onclick={onClose}>Cancel</button>
		<button type="button" class="btn-primary" disabled={!name.trim() || saving} onclick={() => void submit()}>
			{#if saving}<Loader2 class="h-3 w-3 animate-spin" />{:else}<Plus class="h-3 w-3" />{/if}
			Create
		</button>
	</div>
</div>

<style>
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

	.btn-primary { background: var(--brand); color: var(--brand-contrast-fg); }
	.btn-primary:disabled { opacity: 0.55; }
	.btn-ghost { color: var(--text-tertiary); }
	.btn-ghost:hover { background: var(--bg-hover); color: var(--text-secondary); }

	@media (max-width: 640px) {
		.new-label-popover {
			top: auto;
			right: 8px;
			bottom: 8px;
			left: 8px;
			width: auto;
			border-radius: 14px;
		}
	}
</style>
