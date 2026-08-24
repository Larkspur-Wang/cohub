<script lang="ts">
import {
	BOARD_COLORS,
	type BoardConnectionDirection,
	boardColorCssVar,
} from "@neta-art/cohub/board";
import {
	ArrowLeft,
	ArrowRight,
	ArrowRightLeft,
	Minus,
	Trash2,
} from "lucide-svelte";
import { canTapSelectWithHand } from "$lib/board/board-tool";
import type { BoardEditor } from "$lib/board/editor.svelte";
import { getLocale } from "$lib/i18n/locale.svelte";
import { m } from "$lib/paraglide/messages.js";

const { editor }: { editor: BoardEditor } = $props();

const locale = $derived(getLocale());

/**
 * Show only when exactly one connection is selected and no gesture is running.
 * Nodes, multi-selections, and mid-gesture states all hide this toolbar so it
 * never competes with the node selection toolbar or the canvas itself.
 */
const connection = $derived.by(() => {
	if (
		editor.selection.length !== 1 ||
		(editor.tool !== "select" &&
			!(editor.tool === "hand" && canTapSelectWithHand(editor.pointerType))) ||
		editor.interaction.type === "brushing" ||
		editor.interaction.type === "draggingConnectionEnd" ||
		editor.interaction.type === "creatingConnection"
	)
		return null;
	return editor.selectedConnection;
});

/**
 * Position the toolbar above the midpoint of the relation.
 *
 * The midpoint is the arc-length center of the resolved path — it tracks curves
 * and orthogonal elbows rather than just averaging the endpoint coordinates. If
 * the relation resolves to null (one node off-screen) we fall back to null and
 * hide the toolbar.
 */
const position = $derived.by(() => {
	if (!connection) return null;
	const resolved = editor.resolveConnectionGeometry(connection);
	if (!resolved) return null;
	const camera = editor.camera;
	const mid = resolved.mid;
	return {
		left: mid.x * camera.zoom + camera.x,
		top: Math.max(36, mid.y * camera.zoom + camera.y),
	};
});

type DirectionOption = {
	id: BoardConnectionDirection;
	label: string;
	icon: typeof Minus;
};

const DIRECTION_OPTIONS = $derived<DirectionOption[]>([
	{ id: "none", label: m.board_no_direction({}, { locale }), icon: Minus },
	{
		id: "forward",
		label: m.board_direction_source_target({}, { locale }),
		icon: ArrowRight,
	},
	{
		id: "backward",
		label: m.board_direction_target_source({}, { locale }),
		icon: ArrowLeft,
	},
	{
		id: "both",
		label: m.board_direction_bidirectional({}, { locale }),
		icon: ArrowRightLeft,
	},
]);

function setDirection(direction: BoardConnectionDirection) {
	if (!connection) return;
	editor.updateConnection(connection.id, { direction });
}

function setColor(color: string) {
	if (!connection) return;
	editor.updateConnection(connection.id, {
		style: { ...connection.style, color },
	});
}

function deleteSelected() {
	if (!connection) return;
	editor.deleteConnection(connection.id);
}
</script>

{#if connection && position}
	<div
		class="board-connection-toolbar"
		style:left="{position.left}px"
		style:top="{position.top}px"
		role="toolbar"
		aria-label={m.board_connection_actions({}, { locale })}
	>
		<!-- Direction -->
		<div class="group" role="group" aria-label={m.board_direction_label({}, { locale })}>
			{#each DIRECTION_OPTIONS as option (option.id)}
				<button
					type="button"
					class="conn-btn"
					class:conn-btn--active={connection.direction === option.id}
					title={option.label}
					aria-label={option.label}
					aria-pressed={connection.direction === option.id}
					onclick={() => setDirection(option.id)}
				>
					<option.icon class="h-3.5 w-3.5" />
				</button>
			{/each}
		</div>

		<div class="divider"></div>

		<!-- Color -->
		<div class="color-list" role="group" aria-label={m.board_color({}, { locale })}>
			{#each BOARD_COLORS as color (color.id)}
				<button
					type="button"
					class="swatch"
					class:swatch--active={connection.style.color === color.id}
					title={color.label}
					aria-label="Set {color.label} color"
					style:--swatch-color="var({boardColorCssVar(color.id, 'stroke')})"
					onclick={() => setColor(color.id)}
				></button>
			{/each}
		</div>

		<div class="divider"></div>

		<button
			type="button"
			class="conn-btn conn-btn--danger"
			title={m.board_delete_connection({}, { locale })}
			aria-label={m.board_delete_connection({}, { locale })}
			onclick={deleteSelected}
		>
			<Trash2 class="h-3.5 w-3.5" />
		</button>
	</div>
{/if}

<style>
	.board-connection-toolbar {
		position: absolute;
		z-index: 24;
		display: flex;
		align-items: center;
		gap: 2px;
		/* Centered above the midpoint, translated up so it clears the line. */
		transform: translate(-50%, calc(-100% - 14px));
		border-radius: 9px;
		border: 1px solid var(--border-subtle);
		background: color-mix(in srgb, var(--bg-elevated) 94%, transparent);
		padding: 4px;
		box-shadow: 0 8px 20px color-mix(in srgb, var(--overlay-scrim-strong) 14%, transparent);
		backdrop-filter: blur(12px);
		white-space: nowrap;
		/* Prevent the toolbar from sticking out of the panel. */
		max-width: calc(100% - 16px);
		overflow-x: auto;
		scrollbar-width: none;
	}
	.board-connection-toolbar::-webkit-scrollbar { display: none; }

	.group {
		display: flex;
		align-items: center;
		gap: 1px;
	}

	.conn-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border-radius: 6px;
		color: var(--text-secondary);
		cursor: pointer;
		transition: background-color 100ms ease, color 100ms ease;
		flex-shrink: 0;
	}
	.conn-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
	.conn-btn--active {
		background: var(--brand-bg);
		color: var(--brand-muted-fg);
	}
	.conn-btn--danger:hover { background: var(--error-bg); color: var(--error-700); }

	.color-list {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 0 2px;
	}

	.swatch {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		border: 1.5px solid var(--border-subtle);
		background: var(--swatch-color);
		cursor: pointer;
		transition: transform 100ms ease, border-color 100ms ease;
		flex-shrink: 0;
	}
	.swatch:hover { transform: scale(1.18); }
	.swatch--active {
		border-color: var(--text-primary);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--swatch-color) 40%, transparent);
	}

	.divider {
		width: 1px;
		height: 16px;
		margin: 0 3px;
		background: var(--border-subtle);
		flex-shrink: 0;
	}

	/* Touch: fatter targets, safe-area awareness. */
	@media (pointer: coarse) {
		.board-connection-toolbar {
			max-width: calc(100% - 20px);
		}
		.conn-btn { width: 36px; height: 36px; flex-shrink: 0; }
		.swatch { width: 22px; height: 22px; flex-shrink: 0; }
	}
</style>
