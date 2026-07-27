<script lang="ts">
import { TEXT_FONT_SIZE, TEXT_LINE_HEIGHT } from "@neta-art/cohub/board";
import type { BoardEditor } from "$lib/board/editor.svelte";

const { editor }: { editor: BoardEditor } = $props();

let textarea: HTMLTextAreaElement | null = $state(null);
let draft = $state("");

const editingItem = $derived.by(() => {
	const id = editor.editingId;
	if (!id) return null;
	const item = editor.itemById(id);
	if (!item) return null;
	return item.type === "text" || item.type === "geo" ? item : null;
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
		height: Math.max(
			height,
			isPlainText
				? item.fontSize * (TEXT_LINE_HEIGHT / TEXT_FONT_SIZE) * zoom
				: height,
		),
		rotation: item.frame.rotation || 0,
		fontSize: (isPlainText ? item.fontSize : 14) * zoom,
		lineHeight:
			(isPlainText ? item.fontSize * (TEXT_LINE_HEIGHT / TEXT_FONT_SIZE) : 20) *
			zoom,
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
		class="board-text-editor"
		style:left="{layout.left}px"
		style:top="{layout.top}px"
		style:width="{layout.width}px"
		style:height="{layout.height}px"
		style:transform="rotate({layout.rotation}deg)"
		style:font-size="{layout.fontSize}px"
		style:line-height="{layout.lineHeight}px"
		style:padding="{layout.padding}px"
		class:board-text-editor--plain={layout.plain}
		onblur={commit}
		onkeydown={handleKeydown}
		aria-label="Edit text"
	></textarea>
{/if}

<style>
	.board-text-editor {
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

	/* Freestanding text: transparent field, caret only — no card chrome.
	   The family must match BOARD_FONT_STACK, or the caret drifts from the
	   glyphs Pixi draws underneath while editing. */
	.board-text-editor--plain {
		border: 0;
		border-radius: 0;
		background: transparent;
		box-shadow: none;
		caret-color: var(--brand);
		font-family: "Geist", system-ui, -apple-system, "Noto Sans CJK SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
		font-weight: 500;
	}
</style>
