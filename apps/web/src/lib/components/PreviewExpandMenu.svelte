<script lang="ts">
import { Maximize2, Minimize2 } from "lucide-svelte";
import { onDestroy } from "svelte";

const {
	focused = false,
	immersive = false,
	buttonClass = "icon-btn",
	iconClass = "w-4 h-4",
	onToggleFocus,
	onToggleImmersive,
}: {
	focused?: boolean;
	immersive?: boolean;
	buttonClass?: string;
	iconClass?: string;
	onToggleFocus: () => void | Promise<void>;
	onToggleImmersive: () => void | Promise<void>;
} = $props();

let open = $state(false);
let rootEl = $state<HTMLDivElement | null>(null);
const expanded = $derived(focused || immersive);
const title = $derived(
	immersive
		? "Exit immersive preview"
		: focused
			? "Exit preview focus"
			: "Expand preview",
);

function runAction(action: () => void | Promise<void>) {
	Promise.resolve(action()).catch((error) => {
		console.error("Preview expand action failed", error);
	});
}

function toggleMenu(event: MouseEvent) {
	event.stopPropagation();
	if (expanded) {
		runAction(immersive ? onToggleImmersive : onToggleFocus);
		open = false;
		return;
	}
	open = !open;
}

function choose(action: () => void | Promise<void>) {
	open = false;
	runAction(action);
}

function handleDocumentPointerDown(event: PointerEvent) {
	if (!open) return;
	const target = event.target as Node | null;
	if (target && rootEl?.contains(target)) return;
	open = false;
}

function handleDocumentKeydown(event: KeyboardEvent) {
	if (!open) return;
	if (event.key === "Escape") open = false;
}

$effect(() => {
	if (!open) return;
	document.addEventListener("pointerdown", handleDocumentPointerDown, true);
	document.addEventListener("keydown", handleDocumentKeydown);
	return () => {
		document.removeEventListener(
			"pointerdown",
			handleDocumentPointerDown,
			true,
		);
		document.removeEventListener("keydown", handleDocumentKeydown);
	};
});

onDestroy(() => {
	document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
	document.removeEventListener("keydown", handleDocumentKeydown);
});
</script>

<div bind:this={rootEl} class="preview-expand-menu relative shrink-0">
	<button
		type="button"
		class={buttonClass}
		onclick={toggleMenu}
		title={title}
		aria-label={title}
		aria-haspopup="menu"
		aria-expanded={open}
	>
		{#if expanded}
			<Minimize2 class={iconClass} />
		{:else}
			<Maximize2 class={iconClass} />
		{/if}
	</button>
	{#if open}
		<div class="preview-expand-popover" role="menu">
			<button type="button" class="preview-expand-item" onclick={() => choose(onToggleFocus)} role="menuitem">
				<span class="preview-expand-item-title">Focus preview</span>
				<span class="preview-expand-item-desc">Keep panels docked</span>
			</button>
			<button type="button" class="preview-expand-item" onclick={() => choose(onToggleImmersive)} role="menuitem">
				<span class="preview-expand-item-title">Immersive preview</span>
				<span class="preview-expand-item-desc">Float chat and files</span>
			</button>
		</div>
	{/if}
</div>

<style>
	.preview-expand-popover {
		position: absolute;
		right: 0;
		top: calc(100% + 6px);
		z-index: 80;
		width: 190px;
		overflow: hidden;
		border-radius: 8px;
		border: 1px solid var(--border-subtle);
		background: var(--bg-elevated);
		padding: 4px;
		box-shadow: 0 16px 42px color-mix(in srgb, var(--overlay-scrim-strong) 22%, transparent);
	}

	.preview-expand-item {
		display: flex;
		width: 100%;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		border: 0;
		border-radius: 6px;
		background: transparent;
		padding: 7px 8px;
		text-align: left;
		cursor: pointer;
	}

	.preview-expand-item:hover {
		background: var(--bg-hover);
	}

	.preview-expand-item-title {
		font-size: 12px;
		font-weight: 500;
		line-height: 1.25;
		color: var(--text-primary);
	}

	.preview-expand-item-desc {
		font-size: 11px;
		line-height: 1.25;
		color: var(--text-tertiary);
	}
</style>
