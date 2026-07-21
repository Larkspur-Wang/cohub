<script lang="ts">
import { Check, FilePlus2, Link as LinkIcon } from "lucide-svelte";
import { floatNear } from "$lib/actions/portal";
import type { CanvasEditor } from "$lib/canvas/editor.svelte";

type AddMode = "file" | "url";

const {
	editor,
	getAnchor,
	onClose,
}: {
	editor: CanvasEditor;
	getAnchor: () => HTMLElement | null;
	onClose: () => void;
} = $props();

let mode = $state<AddMode>("file");
let value = $state("");
let error = $state<string | null>(null);

const MODES: Array<{ id: AddMode; label: string; placeholder: string }> = [
	{
		id: "file",
		label: "File",
		placeholder: "Space file path, e.g. assets/logo.png",
	},
	{ id: "url", label: "URL", placeholder: "https://example.com/image.png" },
];

const active = $derived(MODES.find((m) => m.id === mode) ?? MODES[0]);

function submit() {
	const trimmed = value.trim();
	if (!trimmed) {
		error = "Enter a value first.";
		return;
	}
	if (mode === "url") {
		try {
			new URL(trimmed);
		} catch {
			error = "That doesn't look like a valid URL.";
			return;
		}
	}
	const at = editor.viewCenter();
	if (mode === "file") editor.addFile(trimmed, at);
	else editor.addUrl(trimmed, at);
	value = "";
	error = null;
	onClose();
}

function handleKeydown(event: KeyboardEvent) {
	event.stopPropagation();
	if (event.key === "Enter" && !event.shiftKey) {
		event.preventDefault();
		submit();
	} else if (event.key === "Escape") {
		onClose();
	}
}
</script>

<div
	class="canvas-add-menu"
	role="dialog"
	aria-label="Add to canvas"
	tabindex="-1"
	use:floatNear={{ getAnchor, placement: "top-start", gap: 8, width: 280, zIndex: 120 }}
	onpointerdown={(event) => event.stopPropagation()}
>
	<div class="flex gap-1 p-1">
		{#each MODES as m (m.id)}
			<button
				type="button"
				class="add-mode"
				class:add-mode--active={mode === m.id}
				onclick={() => { mode = m.id; error = null; }}
			>
				{#if m.id === "file"}<FilePlus2 class="h-3.5 w-3.5" />{:else}<LinkIcon class="h-3.5 w-3.5" />{/if}
				{m.label}
			</button>
		{/each}
	</div>
	<div class="px-2 pb-2">
		<input
			bind:value
			type="text"
			class="add-input"
			placeholder={active.placeholder}
			onkeydown={handleKeydown}
		/>
		{#if error}
			<div class="mt-1.5 text-[11px] text-error-soft">{error}</div>
		{/if}
		<button type="button" class="add-submit" onclick={submit}>
			<Check class="h-3.5 w-3.5" />
			Add to canvas
		</button>
	</div>
</div>

<style>
	.canvas-add-menu {
		border-radius: 10px;
		border: 1px solid var(--border-subtle);
		background: var(--bg-elevated);
		box-shadow: 0 12px 28px color-mix(in srgb, var(--overlay-scrim-strong) 18%, transparent);
		overflow: hidden;
	}

	.add-mode {
		display: inline-flex;
		flex: 1;
		align-items: center;
		justify-content: center;
		gap: 5px;
		height: 28px;
		border-radius: 6px;
		border: 1px solid transparent;
		color: var(--text-secondary);
		font-size: 11px;
		font-weight: 500;
		cursor: pointer;
		transition: background-color 100ms ease, color 100ms ease;
	}
	.add-mode:hover { background: var(--bg-hover); color: var(--text-primary); }
	.add-mode--active {
		background: var(--brand-bg);
		border-color: var(--brand-border);
		color: var(--brand-muted-fg);
	}

	.add-input {
		width: 100%;
		border-radius: 6px;
		border: 1px solid var(--border-subtle);
		background: var(--bg-input);
		padding: 7px 9px;
		color: var(--text-primary);
		font-size: 12px;
		outline: none;
	}
	.add-input:focus { border-color: var(--brand-border); }

	.add-submit {
		display: flex;
		width: 100%;
		align-items: center;
		justify-content: center;
		gap: 6px;
		height: 30px;
		margin-top: 8px;
		border-radius: 6px;
		border: 1px solid var(--brand-border);
		background: var(--brand-bg);
		color: var(--brand-muted-fg);
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		transition: background-color 100ms ease;
	}
	.add-submit:hover { background: var(--brand-soft); }
</style>
