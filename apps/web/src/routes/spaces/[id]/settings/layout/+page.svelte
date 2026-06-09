<script lang="ts">
import {
	DEFAULT_SPACE_LAYOUT,
	type NormalizedSpaceLayout,
	normalizeSpaceLayout,
	normalizeSpaceLayoutManifest,
	SPACE_LAYOUT_MANIFEST_PATH,
	type SpaceLayoutComponent,
	type SpaceLayoutComponentType,
	type SpaceLayoutManifest,
} from "@cohub/protocol";
import { HttpError } from "@neta-art/cohub";
import { ArrowLeft, Check, Loader2, RotateCcw, Save } from "lucide-svelte";
import { goto } from "$app/navigation";
import LayoutCanvas from "$lib/features/space-layout/LayoutCanvas.svelte";
import {
	CORE_LAYOUT_COMPONENTS,
	cloneLayout,
	formatComponentMode,
	getComponent,
	getSizeValue,
	layoutToManifest,
	updateComponent,
} from "$lib/features/space-layout/layout-helpers";
import { sdk } from "$lib/sdk";
import { spaceLayoutState } from "$lib/stores/space-layout.svelte";

const props = $props<{ data: { spaceId: string } }>();
const spaceId = $derived(props.data.spaceId);

let loading = $state(true);
let saving = $state(false);
let error = $state("");
let saveMessage = $state("");
let draft = $state<NormalizedSpaceLayout>(cloneLayout());
let selectedType = $state<SpaceLayoutComponentType>("chat");
let view = $state<"visual" | "json">("visual");
let jsonDraft = $state("");
let jsonError = $state("");

const selectedComponent = $derived(getComponent(draft, selectedType));
const manifestPreview = $derived(layoutToManifest(draft));

function syncJsonFromDraft() {
	jsonDraft = `${JSON.stringify(manifestPreview, null, 2)}\n`;
	jsonError = "";
}

async function loadLayout() {
	const loadingSpaceId = spaceId;
	loading = true;
	error = "";
	try {
		const file = await sdk
			.space(loadingSpaceId)
			.files.read(SPACE_LAYOUT_MANIFEST_PATH);
		if (loadingSpaceId !== spaceId) return;
		if (!("content" in file)) throw new Error("Layout file is not ready yet.");
		const content =
			file.encoding === "base64" ? atob(file.content) : file.content;
		draft = normalizeSpaceLayout(JSON.parse(content));
	} catch (err) {
		if (loadingSpaceId !== spaceId) return;
		if (err instanceof HttpError && err.status === 404)
			draft = cloneLayout(DEFAULT_SPACE_LAYOUT);
		else error = "Failed to load layout.";
	} finally {
		if (loadingSpaceId === spaceId) {
			syncJsonFromDraft();
			loading = false;
		}
	}
}

function applyJsonDraft() {
	try {
		const parsed = JSON.parse(jsonDraft);
		const manifest = normalizeSpaceLayoutManifest(parsed);
		if (!manifest) throw new Error("Invalid layout JSON");
		draft = normalizeSpaceLayout(manifest);
		jsonError = "";
		return true;
	} catch {
		jsonError = "Invalid layout JSON.";
		return false;
	}
}

async function saveLayout() {
	if (view === "json" && !applyJsonDraft()) return;
	saving = true;
	error = "";
	saveMessage = "";
	try {
		const manifest: SpaceLayoutManifest = layoutToManifest(draft);
		await sdk.space(spaceId).files.write({
			path: SPACE_LAYOUT_MANIFEST_PATH,
			content: `${JSON.stringify(manifest, null, 2)}\n`,
			encoding: "utf-8",
		});
		spaceLayoutState.load(spaceId);
		saveMessage = "Layout saved.";
	} catch {
		error = "Failed to save layout.";
	} finally {
		saving = false;
	}
}

function resetDraft() {
	draft = cloneLayout(DEFAULT_SPACE_LAYOUT);
	syncJsonFromDraft();
}

function setSelectedComponent(component: SpaceLayoutComponent) {
	draft = updateComponent(draft, selectedType, () => component);
	if (view === "visual") syncJsonFromDraft();
}

function setPlacementMode(mode: SpaceLayoutComponent["placement"]["mode"]) {
	const component = selectedComponent;
	if (!component) return;
	const order =
		component.placement.mode === "dock" ? component.placement.order : 20;
	setSelectedComponent({
		...component,
		placement:
			mode === "dock"
				? { mode, edge: "right", order }
				: mode === "floating"
					? {
							mode,
							anchor: "top-right",
							position: { x: 0.62, y: 0.12, unit: "ratio" },
							z: 30,
						}
					: { mode },
	});
}

function setDockEdge(edge: "left" | "right" | "top" | "bottom") {
	const component = selectedComponent;
	if (!component) return;
	setSelectedComponent({
		...component,
		placement: {
			mode: "dock",
			edge,
			order:
				component.placement.mode === "dock" ? component.placement.order : 20,
		},
	});
}

function setDockOrder(order: number) {
	const component = selectedComponent;
	if (!component) return;
	setSelectedComponent({
		...component,
		placement: {
			mode: "dock",
			edge:
				component.placement.mode === "dock"
					? component.placement.edge
					: "right",
			order,
		},
	});
}

function setFloatingAnchor(
	anchor: "top-left" | "top-right" | "bottom-left" | "bottom-right",
) {
	const component = selectedComponent;
	if (!component) return;
	setSelectedComponent({
		...component,
		placement: {
			mode: "floating",
			anchor,
			position:
				component.placement.mode === "floating"
					? component.placement.position
					: { x: 0.62, y: 0.12, unit: "ratio" },
			z: component.placement.mode === "floating" ? component.placement.z : 30,
		},
	});
}

function patchComponent(patch: Partial<SpaceLayoutComponent>) {
	const component = selectedComponent;
	if (!component) return;
	setSelectedComponent({ ...component, ...patch });
}

function patchSize(key: "width" | "height", value: number) {
	const component = selectedComponent;
	if (!component) return;
	patchComponent({
		size: { ...(component.size ?? { unit: "px" }), [key]: value },
	});
}

function patchChrome(
	key: "variant" | "header" | "border",
	value: string | boolean,
) {
	const component = selectedComponent;
	if (!component) return;
	patchComponent({ chrome: { ...(component.chrome ?? {}), [key]: value } });
}

function patchSystemBar(
	path: "visibility" | "placement" | "position",
	value: string,
) {
	draft = normalizeSpaceLayout({
		...draft,
		runtime: {
			systemBar: {
				...draft.runtime.systemBar,
				[path]: value,
			},
		},
	});
	syncJsonFromDraft();
}

function patchSystemBarContent(
	key: "brand" | "spaceProfile" | "defaultLayout",
	value: boolean,
) {
	draft = normalizeSpaceLayout({
		...draft,
		runtime: {
			systemBar: {
				...draft.runtime.systemBar,
				content: { ...draft.runtime.systemBar.content, [key]: value },
			},
		},
	});
	syncJsonFromDraft();
}

function moveFloatingComponent(
	type: SpaceLayoutComponentType,
	x: number,
	y: number,
) {
	const component = getComponent(draft, type);
	if (component?.placement.mode !== "floating") return;
	draft = updateComponent(draft, type, (item) => ({
		...item,
		placement: { ...component.placement, position: { x, y, unit: "ratio" } },
	}));
	syncJsonFromDraft();
}

function resizeFloatingComponent(
	type: SpaceLayoutComponentType,
	width: number,
	height: number,
) {
	const component = getComponent(draft, type);
	if (component?.placement.mode !== "floating") return;
	draft = updateComponent(draft, type, (item) => ({
		...item,
		size: { ...item.size, width, height, unit: "ratio" },
	}));
	syncJsonFromDraft();
}

$effect(() => {
	void loadLayout();
});
</script>

<svelte:head><title>Space layout — Cohub</title></svelte:head>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg-primary">
	<header class="flex h-[44px] shrink-0 items-center justify-between border-b border-border-subtle bg-bg-primary px-3 sm:px-4">
		<div class="flex min-w-0 items-center gap-3">
			<button type="button" class="inline-flex h-8 w-8 items-center justify-center rounded-[6px] text-text-tertiary hover:bg-bg-hover hover:text-text-primary" aria-label="Back to settings" onclick={() => goto(`/spaces/${spaceId}/settings`)}>
				<ArrowLeft class="h-4 w-4" />
			</button>
			<div class="min-w-0">
				<div class="truncate text-[13px] font-medium text-text-primary">Space layout</div>
				<div class="hidden text-[11px] text-text-placeholder sm:block">Writes to {SPACE_LAYOUT_MANIFEST_PATH}</div>
			</div>
		</div>
		<div class="flex items-center gap-2">
			<div class="hidden items-center rounded-[6px] border border-border-subtle bg-bg-input p-[2px] sm:flex">
				<button type="button" class="layout-tab" class:active={view === "visual"} onclick={() => { if (view !== "json" || applyJsonDraft()) view = "visual"; }}>Visual</button>
				<button type="button" class="layout-tab" class:active={view === "json"} onclick={() => { view = "json"; syncJsonFromDraft(); }}>JSON</button>
			</div>
			<button type="button" class="layout-action" onclick={resetDraft}><RotateCcw class="h-3.5 w-3.5" /> Reset</button>
			<button type="button" class="layout-primary" onclick={() => void saveLayout()} disabled={saving}>{#if saving}<Loader2 class="h-3.5 w-3.5 animate-spin" />{:else}<Save class="h-3.5 w-3.5" />{/if} Save</button>
		</div>
	</header>

	<main class="min-h-0 flex-1 overflow-hidden">
		{#if loading}
			<div class="flex h-full items-center justify-center gap-2 text-[13px] text-text-tertiary"><Loader2 class="h-4 w-4 animate-spin" /> Loading layout…</div>
		{:else}
			<div class="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_320px]">
				<aside class="min-h-0 border-b border-border-subtle bg-bg-surface/40 p-3 lg:border-b-0 lg:border-r">
					<div class="mb-3 text-[10px] font-medium uppercase tracking-[0.16em] text-text-placeholder">Components</div>
					<div class="space-y-1.5">
						{#each CORE_LAYOUT_COMPONENTS as item (item.type)}
							{@const component = getComponent(draft, item.type)}
							<button type="button" class="component-row" class:active={selectedType === item.type} onclick={() => selectedType = item.type}>
								<span class="component-row__title">{item.label}</span>
								<span class="component-row__meta">{formatComponentMode(component)}</span>
							</button>
						{/each}
					</div>
					<div class="mt-5 rounded-[8px] border border-border-subtle bg-bg-primary p-3 text-[11px] leading-relaxed text-text-tertiary">
						Layout is space-owned. Daily workspace usage is read-only; persistent changes happen here.
					</div>
				</aside>

				<section class="min-h-0 overflow-hidden bg-bg-content p-3 sm:p-4">
					{#if view === "visual"}
						<LayoutCanvas
							components={draft.layout.components}
							{selectedType}
							onSelect={(type) => selectedType = type}
							onMove={moveFloatingComponent}
							onResize={resizeFloatingComponent}
						/>
					{:else}
						<div class="flex h-full min-h-0 flex-col overflow-hidden rounded-[10px] border border-border-subtle bg-bg-primary">
							<div class="flex h-9 items-center justify-between border-b border-border-subtle px-3 text-[12px] text-text-secondary"><span>Layout JSON</span><button type="button" class="text-[11px] text-text-placeholder hover:text-text-primary" onclick={applyJsonDraft}>Apply</button></div>
							<textarea class="min-h-0 flex-1 resize-none bg-bg-primary p-4 font-mono text-[12px] leading-5 text-text-primary outline-none" bind:value={jsonDraft} spellcheck="false"></textarea>
							{#if jsonError}<div class="border-t border-error-soft/30 bg-error-bg px-3 py-2 text-[12px] text-error-soft">{jsonError}</div>{/if}
						</div>
					{/if}
				</section>

				<aside class="min-h-0 overflow-y-auto border-t border-border-subtle bg-bg-surface/40 p-4 lg:border-l lg:border-t-0">
					{#if selectedComponent}
						<div class="mb-4">
							<div class="text-[15px] font-medium text-text-primary">{selectedComponent.title ?? selectedComponent.type}</div>
							<div class="text-[12px] text-text-tertiary">{formatComponentMode(selectedComponent)}</div>
						</div>
						<div class="inspector-section">
							<label for="layout-mode">Mode</label>
							<select id="layout-mode" value={selectedComponent.placement.mode} onchange={(event) => setPlacementMode((event.currentTarget as HTMLSelectElement).value as SpaceLayoutComponent["placement"]["mode"])}>
								<option value="dock">Dock</option><option value="floating">Floating</option><option value="fullscreen">Fullscreen</option><option value="hidden">Hidden</option>
							</select>
						</div>
						{#if selectedComponent.placement.mode === "dock"}
							<div class="inspector-section"><label for="layout-edge">Edge</label><select id="layout-edge" value={selectedComponent.placement.edge ?? "right"} onchange={(event) => setDockEdge((event.currentTarget as HTMLSelectElement).value as "left" | "right" | "top" | "bottom")}><option value="left">Left</option><option value="right">Right</option><option value="top">Top</option><option value="bottom">Bottom</option></select></div>
							<div class="inspector-section"><label for="layout-order">Order</label><input id="layout-order" type="number" value={selectedComponent.placement.order ?? 20} oninput={(event) => setDockOrder(Number((event.currentTarget as HTMLInputElement).value))} /></div>
						{/if}
						{#if selectedComponent.placement.mode === "floating"}
							<div class="inspector-section"><label for="layout-anchor">Anchor</label><select id="layout-anchor" value={selectedComponent.placement.anchor ?? "top-right"} onchange={(event) => setFloatingAnchor((event.currentTarget as HTMLSelectElement).value as "top-left" | "top-right" | "bottom-left" | "bottom-right")}><option value="top-left">Top left</option><option value="top-right">Top right</option><option value="bottom-left">Bottom left</option><option value="bottom-right">Bottom right</option></select></div>
						{/if}
						<div class="grid grid-cols-2 gap-2">
							<div class="inspector-section"><label for="layout-width">Width</label><input id="layout-width" type="number" value={getSizeValue(selectedComponent, "width", 420)} oninput={(event) => patchSize("width", Number((event.currentTarget as HTMLInputElement).value))} /></div>
							<div class="inspector-section"><label for="layout-height">Height</label><input id="layout-height" type="number" value={getSizeValue(selectedComponent, "height", 520)} oninput={(event) => patchSize("height", Number((event.currentTarget as HTMLInputElement).value))} /></div>
						</div>
						<div class="inspector-section"><label for="layout-chrome">Chrome</label><select id="layout-chrome" value={selectedComponent.chrome?.variant ?? "default"} onchange={(event) => patchChrome("variant", (event.currentTarget as HTMLSelectElement).value)}><option value="default">Default</option><option value="minimal">Minimal</option><option value="bare">Bare</option></select></div>
						<label class="check-row"><input type="checkbox" checked={selectedComponent.chrome?.header !== false} onchange={(event) => patchChrome("header", (event.currentTarget as HTMLInputElement).checked)} /> Header</label>
						<label class="check-row"><input type="checkbox" checked={selectedComponent.chrome?.border !== false} onchange={(event) => patchChrome("border", (event.currentTarget as HTMLInputElement).checked)} /> Border</label>
					{/if}

					<div class="mt-6 border-t border-border-subtle pt-4">
						<div class="mb-3 text-[10px] font-medium uppercase tracking-[0.16em] text-text-placeholder">Runtime bar</div>
						<div class="inspector-section"><label for="system-bar-visibility">Visibility</label><select id="system-bar-visibility" value={draft.runtime.systemBar.visibility} onchange={(event) => patchSystemBar("visibility", (event.currentTarget as HTMLSelectElement).value)}><option value="always">Always</option><option value="immersiveOnly">Immersive only</option></select></div>
						<div class="inspector-section"><label for="system-bar-placement">Placement</label><select id="system-bar-placement" value={draft.runtime.systemBar.placement} onchange={(event) => patchSystemBar("placement", (event.currentTarget as HTMLSelectElement).value)}><option value="floating">Floating</option><option value="top">Top</option><option value="right">Right</option><option value="bottom">Bottom</option><option value="left">Left</option></select></div>
						<div class="inspector-section"><label for="system-bar-position">Position</label><select id="system-bar-position" value={draft.runtime.systemBar.position} onchange={(event) => patchSystemBar("position", (event.currentTarget as HTMLSelectElement).value)}><option value="top-left">Top left</option><option value="top-right">Top right</option><option value="bottom-left">Bottom left</option><option value="bottom-right">Bottom right</option></select></div>
						<label class="check-row"><input type="checkbox" checked={draft.runtime.systemBar.content.brand} onchange={(event) => patchSystemBarContent("brand", (event.currentTarget as HTMLInputElement).checked)} /> Brand</label>
						<label class="check-row"><input type="checkbox" checked={draft.runtime.systemBar.content.spaceProfile} onchange={(event) => patchSystemBarContent("spaceProfile", (event.currentTarget as HTMLInputElement).checked)} /> Space profile</label>
						<label class="check-row"><input type="checkbox" checked={draft.runtime.systemBar.content.defaultLayout} onchange={(event) => patchSystemBarContent("defaultLayout", (event.currentTarget as HTMLInputElement).checked)} /> Default layout</label>
					</div>
					{#if saveMessage}<div class="mt-4 flex items-center gap-2 rounded-[6px] border border-success-soft/30 bg-success-bg px-3 py-2 text-[12px] text-success-soft"><Check class="h-3.5 w-3.5" /> {saveMessage}</div>{/if}
					{#if error}<div class="mt-4 rounded-[6px] border border-error-soft/30 bg-error-bg px-3 py-2 text-[12px] text-error-soft">{error}</div>{/if}
				</aside>
			</div>
		{/if}
	</main>
</div>


<style>
	.layout-tab, .layout-action, .layout-primary { display: inline-flex; min-height: 30px; align-items: center; gap: 6px; border-radius: 5px; padding: 0 10px; font-size: 12px; font-weight: 500; }
	.layout-tab { color: var(--text-tertiary); }
	.layout-tab.active, .layout-tab:hover, .layout-action:hover { background: var(--bg-hover); color: var(--text-primary); }
	.layout-action { border: 1px solid var(--border-subtle); color: var(--text-secondary); }
	.layout-primary { background: var(--brand); color: var(--brand-contrast-fg); }
	.layout-primary:disabled { opacity: .55; }
	.component-row { display: flex; width: 100%; flex-direction: column; gap: 2px; border-radius: 7px; padding: 9px 10px; text-align: left; color: var(--text-tertiary); }
	.component-row:hover, .component-row.active { background: var(--bg-hover); color: var(--text-primary); }
	.component-row__title { font-size: 13px; font-weight: 500; }
	.component-row__meta { font-size: 11px; color: var(--text-placeholder); }
	.inspector-section { margin-bottom: 12px; }
	.inspector-section label { margin-bottom: 6px; display: block; font-size: 10px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: var(--text-placeholder); }
	.inspector-section select, .inspector-section input { min-height: 34px; width: 100%; border-radius: 6px; border: 1px solid var(--border-subtle); background: var(--bg-input); padding: 0 10px; font-size: 12px; color: var(--text-primary); outline: none; }
	.inspector-section select:focus, .inspector-section input:focus { border-color: color-mix(in srgb, var(--brand) 45%, var(--border-subtle)); }
	.check-row { display: flex; min-height: 30px; align-items: center; gap: 8px; font-size: 12px; color: var(--text-secondary); }
</style>
