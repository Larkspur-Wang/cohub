<script lang="ts">
import type { AppNavigationOpenMessage } from "@cohub/protocol/app-navigation";
import type {
	AppDetailResponse,
	AppRuntimeShellContext,
} from "@neta-art/cohub";
import { onDestroy, untrack } from "svelte";
import type { BoardEditor } from "$lib/board/editor.svelte";
import AppSurface from "$lib/components/app/AppSurface.svelte";
import CenteredLoading from "$lib/components/CenteredLoading.svelte";
import { sdk } from "$lib/sdk";

let {
	editor,
	spaceId,
	surface,
	shell,
	onNavigationOpen,
	readonly = false,
}: {
	editor: BoardEditor;
	spaceId: string;
	readonly?: boolean;
	surface: { width: number; height: number };
	shell?: AppRuntimeShellContext;
	onNavigationOpen?: (message: AppNavigationOpenMessage) => Promise<{
		handled: boolean;
		reason?: "unsupported" | "invalid_target" | "inaccessible" | "timeout";
		call?:
			| { ok: true; result?: unknown }
			| { ok: false; code: string; message: string };
	}>;
} = $props();

type AppMeta = {
	appId: string;
	ref: string;
	url: string;
	name: string;
	icon?: string;
};

type OverlayApp = {
	id: string;
	frame: BoardEditor["items"][number]["frame"];
	meta: AppMeta;
};

function appMeta(item: BoardEditor["items"][number]): AppMeta | null {
	if (
		item.type !== "frame" ||
		!item.metadata ||
		typeof item.metadata !== "object"
	)
		return null;
	const value = (item.metadata as { cohubApp?: unknown }).cohubApp;
	if (!value || typeof value !== "object") return null;
	const meta = value as Partial<AppMeta>;
	if (!meta.appId || !meta.ref || !meta.url || !meta.name) return null;
	return {
		appId: meta.appId,
		ref: meta.ref,
		url: meta.url,
		name: meta.name,
		icon: meta.icon,
	};
}

const apps = $derived.by<OverlayApp[]>(() =>
	editor.items.flatMap((item) => {
		const meta = appMeta(item);
		return meta ? [{ id: item.id, frame: item.frame, meta }] : [];
	}),
);

let details = $state<Record<string, AppDetailResponse | null>>({});
let loading = $state<Record<string, boolean>>({});
let visualCamera = $state({ ...untrack(() => editor.camera) });
let cameraFrame = 0;

// Coalesce camera and geometry changes so iframe layout is updated once per frame.
$effect(() => {
	const nextCamera = editor.camera;
	editor.geometryVersion;
	if (cameraFrame) cancelAnimationFrame(cameraFrame);
	cameraFrame = requestAnimationFrame(() => {
		visualCamera = nextCamera;
		cameraFrame = 0;
	});
});

function isVisible(app: OverlayApp) {
	const zoom = visualCamera.zoom;
	const left = app.frame.x * zoom + visualCamera.x;
	const top = app.frame.y * zoom + visualCamera.y;
	const right = left + app.frame.width * zoom;
	const bottom = top + app.frame.height * zoom;
	const margin = 240;
	return (
		right >= -margin &&
		bottom >= -margin &&
		left <= surface.width + margin &&
		top <= surface.height + margin
	);
}

const visibleApps = $derived(apps.filter(isVisible));

$effect(() => {
	for (const item of visibleApps) {
		if (item.meta.appId in details || loading[item.meta.appId]) continue;
		loading[item.meta.appId] = true;
		void sdk.apps
			.get(item.meta.appId)
			.catch((cause: unknown) => {
				const status = (cause as { status?: unknown } | null)?.status;
				if (status !== 401 && status !== 403) throw cause;
				return sdk.apps.getPublicById(item.meta.appId);
			})
			.then(
				(detail) => {
					details[item.meta.appId] = detail;
				},
				() => {
					details[item.meta.appId] = null;
				},
			)
			.finally(() => {
				loading[item.meta.appId] = false;
			});
	}
});

function styleFor(app: OverlayApp) {
	const { frame } = app;
	return `left:${frame.x * visualCamera.zoom + visualCamera.x}px;top:${frame.y * visualCamera.zoom + visualCamera.y}px;width:${frame.width * visualCamera.zoom}px;height:${frame.height * visualCamera.zoom}px;transform:rotate(${frame.rotation}rad);`;
}

function select(id: string) {
	editor.setSelection([id]);
}

onDestroy(() => {
	if (cameraFrame) cancelAnimationFrame(cameraFrame);
});
</script>

<div class="board-app-overlay">
	{#each visibleApps as app (app.id)}
		{@const detail = details[app.meta.appId]}
		<div
			class="board-app-node"
			class:selected={editor.selection.includes(app.id)}
			style={styleFor(app)}
			role="button"
			tabindex="-1"
			onpointerdown={(event) => { event.stopPropagation(); select(app.id); }}
		>
			<div class="board-app-bar">
				{#if app.meta.icon}<img src={app.meta.icon} alt="" />{/if}
				<span>{app.meta.name}</span>
			</div>
			<div class="board-app-content">
				{#if detail}
					<AppSurface
						mode="app"
						app={detail.app}
						space={detail.space}
						owner={detail.owner}
						content={detail.content}
						shell={shell}
						onNavigationOpen={onNavigationOpen}
					/>
				{:else if loading[app.meta.appId]}
					<CenteredLoading label="Loading App" size="panel" />
				{:else}
					<div class="board-app-error">App unavailable</div>
				{/if}
			</div>
		</div>
	{/each}
</div>

<style>
	.board-app-overlay {
		position: absolute;
		inset: 0;
		z-index: 2;
		pointer-events: none;
		overflow: hidden;
	}
	.board-app-node {
		position: absolute;
		min-width: 280px;
		min-height: 180px;
		pointer-events: none;
		overflow: hidden;
		border: 1px solid var(--border-subtle);
		border-radius: 8px;
		background: var(--bg-primary);
		box-shadow: 0 8px 24px color-mix(in srgb, var(--text-primary) 12%, transparent);
		transform-origin: center;
	}
	.board-app-node.selected { border-color: var(--brand-border); }
	.board-app-node.selected .board-app-content,
	.board-app-node.selected .board-app-bar { pointer-events: none; }
	.board-app-node:not(.selected) .board-app-content,
	.board-app-node:not(.selected) .board-app-bar { pointer-events: auto; }
	.board-app-bar {
		display: flex;
		height: 28px;
		align-items: center;
		gap: 6px;
		padding: 0 8px;
		background: var(--bg-elevated);
		color: var(--text-secondary);
		font-size: 11px;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
	}
	.board-app-bar img { width: 16px; height: 16px; border-radius: 4px; object-fit: cover; }
	.board-app-bar span { overflow: hidden; text-overflow: ellipsis; }
	.board-app-content {
		height: calc(100% - 28px);
		min-height: 0;
		margin: 8px;
		border-radius: 4px;
		overflow: hidden;
	}
	.board-app-error { display: grid; height: 100%; place-items: center; color: var(--text-tertiary); font-size: 12px; }
</style>
