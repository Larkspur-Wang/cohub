<script lang="ts">
import type { SpaceCommerceFeatureBenefit } from "@neta-art/cohub";
import { Loader2, Plus, Trash2 } from "lucide-svelte";
import { untrack } from "svelte";

type MetaType = "string" | "number" | "boolean";

type MetaRow = {
	id: string;
	key: string;
	type: MetaType;
	/** Stored as a string; parsed according to `type` on submit. */
	value: string;
};

const {
	benefit,
	onSubmit,
	onCancel,
	busy = false,
}: {
	benefit?: SpaceCommerceFeatureBenefit | null;
	onSubmit: (input: {
		key?: string;
		name: string;
		description?: string;
		metadata: Record<string, string | number | boolean>;
	}) => Promise<void>;
	onCancel: () => void;
	busy?: boolean;
} = $props();

const isEdit = $derived(Boolean(benefit));

function makeRow(partial: Partial<MetaRow> = {}): MetaRow {
	return {
		id: crypto.randomUUID(),
		key: "",
		type: "string",
		value: "",
		...partial,
	};
}

function parseMetadata(
	metadata: Record<string, string | number | boolean>,
): MetaRow[] {
	return Object.entries(metadata).map(([rowKey, value]) => {
		const type: MetaType =
			typeof value === "boolean"
				? "boolean"
				: typeof value === "number"
					? "number"
					: "string";
		return {
			id: crypto.randomUUID(),
			key: rowKey,
			type,
			value: type === "boolean" ? (value ? "true" : "false") : String(value),
		};
	});
}

// Snapshot the seed once: form fields are editable copies, not reactive mirrors.
const seed = untrack(() => {
	const metadata = benefit?.config?.metadata;
	if (metadata && Object.keys(metadata).length > 0) {
		return {
			key: benefit?.key ?? "",
			name: benefit?.name ?? "",
			description: benefit?.description ?? "",
			rows: parseMetadata(metadata),
		};
	}
	return {
		key: benefit?.key ?? "",
		name: benefit?.name ?? "",
		description: benefit?.description ?? "",
		rows: [makeRow({ key: "enabled", type: "boolean", value: "true" })],
	};
});

const systemKey = seed.key;
let name = $state(seed.name);
let description = $state(seed.description);
let error = $state("");
let rows = $state<MetaRow[]>(seed.rows);

function addRow() {
	rows = [...rows, makeRow()];
}

function removeRow(id: string) {
	rows = rows.filter((row) => row.id !== id);
}

function changeType(id: string, type: MetaType) {
	rows = rows.map((row) =>
		row.id === id
			? {
					...row,
					type,
					value: type === "boolean" ? "true" : type === "number" ? "0" : "",
				}
			: row,
	);
}

function buildMetadata(): Record<string, string | number | boolean> {
	const metadata: Record<string, string | number | boolean> = {};
	for (const row of rows) {
		const rowKey = row.key.trim();
		if (!rowKey) continue;
		if (row.type === "boolean") {
			metadata[rowKey] = row.value === "true";
		} else if (row.type === "number") {
			metadata[rowKey] = row.value === "" ? 0 : Number(row.value);
		} else {
			metadata[rowKey] = row.value;
		}
	}
	return metadata;
}

const nameInvalid = $derived(!name.trim());

async function submit() {
	error = "";
	if (nameInvalid) return;
	try {
		await onSubmit({
			...(isEdit && systemKey ? { key: systemKey } : {}),
			name: name.trim(),
			description: description.trim() || undefined,
			metadata: buildMetadata(),
		});
	} catch (err) {
		error = err instanceof Error ? err.message : "Failed to save benefit.";
	}
}

const inputClass =
	"h-9 w-full rounded-[6px] border border-border-subtle bg-bg-input px-3 text-[13px] text-text-primary placeholder:text-text-placeholder transition-colors focus:border-brand/50 focus:outline-none disabled:opacity-60";
const labelClass =
	"text-[11px] font-medium uppercase tracking-wide text-text-tertiary";
const readonlyClass =
	"flex h-9 w-full items-center rounded-[6px] border border-border-subtle bg-bg-input px-3 font-mono text-[13px] text-text-tertiary";
</script>

<div class="flex flex-col gap-4 p-4 sm:p-5">
	<!-- Type selector (extensibility scaffold: only Feature is active) -->
	<div class="flex flex-col gap-1.5">
		<span class={labelClass}>Benefit type</span>
		<div class="inline-flex w-fit rounded-[6px] border border-border-subtle bg-bg-subtle p-0.5 text-[12px]">
			<span class="rounded-[5px] bg-bg-input px-3 py-1.5 font-medium text-text-primary shadow-sm">Feature</span>
			<span class="rounded-[5px] px-3 py-1.5 text-text-placeholder">Credits · soon</span>
		</div>
		<span class="text-[11px] text-text-tertiary">Feature benefits gate access to product capabilities.</span>
	</div>

	{#if isEdit}
		<div class="grid gap-4 sm:grid-cols-2">
			<div class="flex flex-col gap-1.5">
				<label class={labelClass} for="benefit-name">Name</label>
				<input
					id="benefit-name"
					class={inputClass}
					bind:value={name}
					disabled={busy}
					placeholder="Premium Export"
					autocomplete="off"
				/>
			</div>
			<div class="flex flex-col gap-1.5">
				<span class={labelClass}>System key</span>
				<div class={readonlyClass}>{systemKey}</div>
				<span class="text-[11px] text-text-tertiary">Generated at creation and immutable.</span>
			</div>
		</div>
	{:else}
		<div class="flex flex-col gap-1.5">
			<label class={labelClass} for="benefit-name">Name</label>
			<input
				id="benefit-name"
				class={inputClass}
				bind:value={name}
				disabled={busy}
				placeholder="Premium Export"
				autocomplete="off"
			/>
			<span class="text-[11px] text-text-tertiary">A stable key is generated from this name.</span>
		</div>
	{/if}

	<div class="flex flex-col gap-1.5">
		<label class={labelClass} for="benefit-description">Description</label>
		<textarea
			id="benefit-description"
			class="min-h-16 w-full resize-y rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 text-[13px] leading-5 text-text-primary placeholder:text-text-placeholder transition-colors focus:border-brand/50 focus:outline-none disabled:opacity-60"
			bind:value={description}
			disabled={busy}
			rows={2}
			maxlength="2048"
			placeholder="What this benefit grants (optional)"
		></textarea>
	</div>

	<!-- Metadata editor -->
	<div class="flex flex-col gap-2">
		<div class="flex items-center justify-between">
			<span class={labelClass}>Metadata</span>
			<button
				type="button"
				class="inline-flex h-7 items-center gap-1 rounded-[5px] px-2 text-[11px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
				onclick={addRow}
				disabled={busy}
			>
				<Plus class="h-3 w-3" /> Add field
			</button>
		</div>
		<span class="text-[11px] text-text-tertiary">Configure the entitlement. <code class="font-mono text-text-secondary">enabled</code> toggles access; numeric values set limits.</span>

		<div class="flex flex-col gap-2">
			{#each rows as row (row.id)}
				<div class="flex flex-wrap items-center gap-2">
					<input
						class={inputClass + " min-w-[120px] flex-1 font-mono"}
						bind:value={row.key}
						disabled={busy}
						placeholder="enabled"
						autocomplete="off"
						spellcheck="false"
					/>
					<select
						class="h-9 rounded-[6px] border border-border-subtle bg-bg-input px-2 text-[12px] text-text-primary transition-colors focus:border-brand/50 focus:outline-none disabled:opacity-60"
						value={row.type}
						onchange={(e) => changeType(row.id, e.currentTarget.value as MetaType)}
						disabled={busy}
						aria-label="Field type"
					>
						<option value="string">text</option>
						<option value="number">number</option>
						<option value="boolean">bool</option>
					</select>
					{#if row.type === "boolean"}
						<button
							type="button"
							class="h-9 min-w-[72px] flex-1 rounded-[6px] border border-border-subtle bg-bg-input px-3 text-[13px] font-medium text-text-primary transition-colors hover:bg-bg-hover disabled:opacity-60"
							onclick={() => (row.value = row.value === "true" ? "false" : "true")}
							disabled={busy}
						>
							{row.value === "true" ? "true" : "false"}
						</button>
					{:else if row.type === "number"}
						<input
							class={inputClass + " min-w-[100px] flex-1 font-mono"}
							type="number"
							bind:value={row.value}
							disabled={busy}
							placeholder="0"
						/>
					{:else}
						<input
							class={inputClass + " min-w-[100px] flex-1"}
							bind:value={row.value}
							disabled={busy}
							placeholder="value"
						/>
					{/if}
					<button
						type="button"
						class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] text-text-placeholder transition-colors hover:bg-bg-hover hover:text-error-soft disabled:opacity-50"
						onclick={() => removeRow(row.id)}
						disabled={busy}
						aria-label="Remove field"
					>
						<Trash2 class="h-3.5 w-3.5" />
					</button>
				</div>
			{:else}
				<div class="rounded-[6px] border border-dashed border-border-subtle px-3 py-4 text-center text-[12px] text-text-tertiary">
					No metadata fields. Add one to configure the entitlement.
				</div>
			{/each}
		</div>
	</div>

	{#if error}
		<div class="rounded-[6px] border border-error-soft/30 bg-error-bg px-3 py-2 text-[12px] text-error-soft">{error}</div>
	{/if}

	<div class="flex items-center justify-end gap-2 pt-1">
		<button
			type="button"
			class="inline-flex h-9 items-center justify-center rounded-[6px] px-3 text-[12px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
			onclick={onCancel}
			disabled={busy}
		>
			Cancel
		</button>
		<button
			type="button"
			class="inline-flex h-9 items-center justify-center gap-1.5 rounded-[6px] bg-brand px-3 text-[12px] font-medium text-brand-contrast-fg transition-opacity disabled:opacity-50"
			onclick={() => void submit()}
			disabled={busy || nameInvalid}
		>
			{#if busy}<Loader2 class="h-3.5 w-3.5 animate-spin" />{/if}
			{isEdit ? "Save changes" : "Create benefit"}
		</button>
	</div>
</div>
