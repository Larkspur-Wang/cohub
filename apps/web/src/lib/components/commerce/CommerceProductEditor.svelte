<script lang="ts">
import type { BillingCatalogProduct } from "@neta-art/cohub";
import { Loader2 } from "lucide-svelte";
import { untrack } from "svelte";

const {
	product,
	onSubmit,
	onCancel,
	busy = false,
}: {
	product?: BillingCatalogProduct | null;
	onSubmit: (input: {
		key: string;
		name: string;
		description?: string;
		amountUsd: number;
		status: "draft" | "active";
		visibility: "public" | "private";
	}) => Promise<void>;
	onCancel: () => void;
	busy?: boolean;
} = $props();

const isEdit = $derived(Boolean(product));

// Snapshot the seed once: form fields are editable copies, not reactive mirrors.
const seed = untrack(() => ({
	key: product?.key ?? "",
	name: product?.name ?? "",
	description: product?.description ?? "",
	amountUsd: product ? product.pricing.amountUsd.toFixed(2) : "9.99",
	visibility: (product?.visibility === "private" ? "private" : "public") as
		| "public"
		| "private",
	status: (product?.status === "draft" ? "draft" : "active") as
		| "draft"
		| "active",
}));

let key = $state(seed.key);
let name = $state(seed.name);
let description = $state(seed.description);
let amountUsd = $state(seed.amountUsd);
let visibility = $state<"public" | "private">(seed.visibility);
let status = $state<"draft" | "active">(seed.status);
let error = $state("");

const keyInvalid = $derived(!key.trim());
const nameInvalid = $derived(!name.trim());
const amountInvalid = $derived(
	!Number.isFinite(Number(amountUsd)) || Number(amountUsd) < 0,
);

async function submit() {
	error = "";
	if (keyInvalid || nameInvalid || amountInvalid) return;
	try {
		await onSubmit({
			key: key.trim(),
			name: name.trim(),
			description: description.trim() || undefined,
			amountUsd: Number(amountUsd),
			status,
			visibility,
		});
	} catch (err) {
		error = err instanceof Error ? err.message : "Failed to save product.";
	}
}

function humanizeKey(value: string): string {
	return value
		.split(/[._\s-]+/g)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function onKeyInput(event: Event) {
	key = (event.currentTarget as HTMLInputElement).value;
	if (!name.trim()) name = humanizeKey(key);
}

const inputClass =
	"h-9 w-full rounded-[6px] border border-border-subtle bg-bg-input px-3 text-[13px] text-text-primary placeholder:text-text-placeholder transition-colors focus:border-brand/50 focus:outline-none disabled:opacity-60";
const labelClass =
	"text-[11px] font-medium uppercase tracking-wide text-text-tertiary";
</script>

<div class="flex flex-col gap-4 p-4 sm:p-5">
	<!-- Billing type selector (extensibility scaffold: only One-time is active) -->
	<div class="flex flex-col gap-1.5">
		<span class={labelClass}>Billing type</span>
		<div class="inline-flex w-fit rounded-[6px] border border-border-subtle bg-bg-subtle p-0.5 text-[12px]">
			<span class="rounded-[5px] bg-bg-input px-3 py-1.5 font-medium text-text-primary shadow-sm">One-time</span>
			<span class="rounded-[5px] px-3 py-1.5 text-text-placeholder">Recurring · soon</span>
		</div>
		<span class="text-[11px] text-text-tertiary">One-time products are purchased once and grant their bound benefits immediately.</span>
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="flex flex-col gap-1.5">
			<label class={labelClass} for="product-key">Key</label>
			<input
				id="product-key"
				class={inputClass + " font-mono"}
				value={key}
				disabled={isEdit || busy}
				placeholder="starter_pack"
				oninput={onKeyInput}
				autocomplete="off"
				spellcheck="false"
			/>
			<span class="text-[11px] text-text-tertiary">{isEdit ? "Key can't be changed after creation." : "A unique identifier for this product."}</span>
		</div>

		<div class="flex flex-col gap-1.5">
			<label class={labelClass} for="product-name">Name</label>
			<input
				id="product-name"
				class={inputClass}
				bind:value={name}
				disabled={busy}
				placeholder="Starter Pack"
				autocomplete="off"
			/>
		</div>
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="flex flex-col gap-1.5">
			<label class={labelClass} for="product-price">Price (USD)</label>
			<div class="relative">
				<span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-text-tertiary">$</span>
				<input
					id="product-price"
					class={inputClass + " pl-7 font-mono"}
					class:opacity-60={isEdit}
					type="number"
					step="0.01"
					min="0"
					bind:value={amountUsd}
					disabled={isEdit || busy}
					placeholder="9.99"
				/>
			</div>
			<span class="text-[11px] text-text-tertiary">{isEdit ? "Price can't be changed after creation." : "Charged once at checkout."}</span>
		</div>

		<div class="flex flex-col gap-1.5">
			<label class={labelClass} for="product-status">Status</label>
			<select
				id="product-status"
				class={inputClass}
				bind:value={status}
				disabled={busy}
			>
				<option value="active">Active</option>
				<option value="draft">Draft</option>
			</select>
			<span class="text-[11px] text-text-tertiary">Draft products are hidden from buyers.</span>
		</div>
	</div>

	<div class="flex flex-col gap-1.5">
		<span class={labelClass}>Visibility</span>
		<div class="inline-flex w-fit rounded-[6px] border border-border-subtle bg-bg-subtle p-0.5 text-[12px]">
			<button
				type="button"
				class="rounded-[5px] px-3 py-1.5 transition-colors {visibility === 'public' ? 'bg-bg-input text-text-primary shadow-sm' : 'text-text-tertiary hover:text-text-secondary'}"
				onclick={() => (visibility = "public")}
				disabled={busy}
			>Public</button>
			<button
				type="button"
				class="rounded-[5px] px-3 py-1.5 transition-colors {visibility === 'private' ? 'bg-bg-input text-text-primary shadow-sm' : 'text-text-tertiary hover:text-text-secondary'}"
				onclick={() => (visibility = "private")}
				disabled={busy}
			>Private</button>
		</div>
		<span class="text-[11px] text-text-tertiary">Private products are only purchasable via direct links.</span>
	</div>

	<div class="flex flex-col gap-1.5">
		<label class={labelClass} for="product-description">Description</label>
		<textarea
			id="product-description"
			class="min-h-16 w-full resize-y rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 text-[13px] leading-5 text-text-primary placeholder:text-text-placeholder transition-colors focus:border-brand/50 focus:outline-none disabled:opacity-60"
			bind:value={description}
			disabled={busy}
			rows={2}
			maxlength="2048"
			placeholder="What buyers get with this product (optional)"
		></textarea>
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
			disabled={busy || keyInvalid || nameInvalid || amountInvalid}
		>
			{#if busy}<Loader2 class="h-3.5 w-3.5 animate-spin" />{/if}
			{isEdit ? "Save changes" : "Create product"}
		</button>
	</div>
</div>
