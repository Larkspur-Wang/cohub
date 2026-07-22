<script lang="ts">
import type { CanvasEditor } from "$lib/canvas/editor.svelte";
import {
	TEXT_FONT_FAMILY,
	TEXT_FONT_SIZE,
	TEXT_LINE_HEIGHT,
} from "$lib/canvas/renderers/text-card-renderer";

const { editor }: { editor: CanvasEditor } = $props();

let textarea: HTMLTextAreaElement | null = $state(null);
let draft = $state("");

const editingItem = $derived.by(() => {
	const id = editor.editingId;
	if (!id) return null;
	const item = editor.items.find((candidate) => candidate.id === id);
	if (!item) return null;
	return item.type === "text" || item.type === "note" || item.type === "geo"
		? item
		: null;
});

// Position the textarea exactly over the card. The card rotates about its
// center, so anchor the box at the card center and rotate about center too.
const layout = $derived.by(() => {
	const item = editingItem;
	if (!item) return null;
	const camera = editor.camera;
	const zoom = camera.zoom;
	const width = item.frame.width * zoom;
	const height = item.frame.height * zoom;
	const centerX = (item.frame.x + item.frame.width / 2) * zoom + camera.x;
	const centerY = (item.frame.y + item.frame.height / 2) * zoom + camera.y;
	const isPlainText = item.type === "text";
	return {
		left: centerX - width / 2,
		top: centerY - height / 2,
		width: Math.max(width, isPlainText ? 24 * zoom : width),
		height: Math.max(height, isPlainText ? TEXT_LINE_HEIGHT * zoom : height),
		rotation: item.frame.rotation || 0,
		fontSize: (isPlainText ? TEXT_FONT_SIZE : 14) * zoom,
		lineHeight: (isPlainText ? TEXT_LINE_HEIGHT : 20) * zoom,
		padding: isPlainText ? 0 : 12 * zoom,
		plain: isPlainText,
	};
});

$effect(() => {
	const item = editingItem;
	if (item) {
		draft = item.text;
		queueMicrotask(() => {
			textarea?.focus();
			textarea?.select();
		});
	}
});

function commit() {
	const item = editingItem;
	if (!item) return;
	editor.commitTextEdit(item.id, draft);
}

function handleKeydown(event: KeyboardEvent) {
	event.stopPropagation();
	if (
		event.key === "Escape" ||
		(event.key === "Enter" && (event.metaKey || event.ctrlKey))
	) {
		event.preventDefault();
		commit();
	}
}
</script>

{#if editingItem && layout}
	<textarea
		bind:this={textarea}
		bind:value={draft}
		class="canvas-text-editor"
		style:left="{layout.left}px"
		style:top="{layout.top}px"
		style:width="{layout.width}px"
		style:height="{layout.height}px"
		style:transform="rotate({layout.rotation}deg)"
		style:font-size="{layout.fontSize}px"
		style:line-height="{layout.lineHeight}px"
		style:padding="{layout.padding}px"
		class:canvas-text-editor--plain={layout.plain}
		onblur={commit}
		onkeydown={handleKeydown}
		aria-label="Edit text"
	></textarea>
{/if}

<style>
	.canvas-text-editor {
		position: absolute;
		z-index: 30;
		transform-origin: center center;
		resize: none;
		overflow: hidden;
		border: 1px solid var(--brand-border);
		border-radius: 10px;
		background: color-mix(in srgb, var(--bg-surface) 96%, transparent);
		color: var(--text-primary);
		font-family: var(--font-sans);
		line-height: 1.35;
		outline: none;
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand) 18%, transparent);
	}

	/* Freestanding text: transparent field, caret only — no card chrome. */
	.canvas-text-editor--plain {
		border: 0;
		border-radius: 0;
		background: transparent;
		box-shadow: none;
		caret-color: var(--brand);
		font-family: Geist, var(--font-sans), system-ui, sans-serif;
		font-weight: 500;
	}
</style>
