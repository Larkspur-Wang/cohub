import {
	compactSpaceLayout,
	DEFAULT_SPACE_LAYOUT,
	type NormalizedSpaceLayout,
	normalizeSpaceLayout,
	type SpaceLayoutComponent,
	type SpaceLayoutComponentType,
	type SpaceLayoutManifest,
} from "@cohub/protocol";

export const CORE_LAYOUT_COMPONENTS: Array<{
	type: SpaceLayoutComponentType;
	label: string;
	description: string;
}> = [
	{ type: "chat", label: "Chat", description: "Conversation and composer." },
	{
		type: "fileBrowser",
		label: "File browser",
		description: "Browse and manage Space files.",
	},
	{
		type: "fileViewer",
		label: "File viewer",
		description: "View and edit opened files.",
	},
	{ type: "canvas", label: "Canvas", description: "Covas canvas documents." },
	{
		type: "portsPreview",
		label: "Ports preview",
		description: "Preview sandbox ports and running web apps.",
	},
];

export function cloneLayout(
	layout: NormalizedSpaceLayout = DEFAULT_SPACE_LAYOUT,
): NormalizedSpaceLayout {
	return normalizeSpaceLayout(
		JSON.parse(JSON.stringify(compactSpaceLayout(layout))),
	);
}

export function layoutToManifest(
	layout: NormalizedSpaceLayout,
): SpaceLayoutManifest {
	return compactSpaceLayout(layout);
}

export function getComponent(
	layout: NormalizedSpaceLayout,
	type: SpaceLayoutComponentType,
) {
	return layout.layout.components.find((component) => component.type === type);
}

export function updateComponent(
	layout: NormalizedSpaceLayout,
	type: SpaceLayoutComponentType,
	updater: (component: SpaceLayoutComponent) => SpaceLayoutComponent,
): NormalizedSpaceLayout {
	const next = cloneLayout(layout);
	const index = next.layout.components.findIndex(
		(component) => component.type === type,
	);
	if (index === -1) return next;
	next.layout.components[index] = updater(next.layout.components[index]);
	return normalizeSpaceLayout(next);
}

export function upsertComponent(
	layout: NormalizedSpaceLayout,
	component: SpaceLayoutComponent,
): NormalizedSpaceLayout {
	const next = cloneLayout(layout);
	const index = next.layout.components.findIndex(
		(item) => item.type === component.type,
	);
	if (index === -1) next.layout.components.push(component);
	else next.layout.components[index] = component;
	return normalizeSpaceLayout(next);
}

export function removeComponent(
	layout: NormalizedSpaceLayout,
	type: SpaceLayoutComponentType,
): NormalizedSpaceLayout {
	const next = cloneLayout(layout);
	next.layout.components = next.layout.components.filter(
		(component) => component.type !== type,
	);
	return normalizeSpaceLayout(next);
}

export function getSizeValue(
	component: SpaceLayoutComponent | undefined,
	key: "width" | "height",
	fallback: number,
) {
	const value = component?.size?.[key];
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function formatComponentMode(
	component: SpaceLayoutComponent | undefined,
) {
	if (!component) return "Not configured";
	const mode = component.placement.mode;
	if (mode === "dock") return `Dock ${component.placement.edge ?? "right"}`;
	if (mode === "floating") return "Floating";
	if (mode === "fullscreen") return "Fullscreen";
	return "Hidden";
}
