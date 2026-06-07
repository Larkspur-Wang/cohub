export const SPACE_LAYOUT_MANIFEST_PATH = ".cohub/space.layout.json";

export type SpaceLayoutVersion = 1;
export type SpaceChatPanelMode = "main" | "floating" | "hidden";
export type SpaceSidePanelMode = "dock" | "floating" | "hidden";
export type SpacePreviewPanelMode = "dock" | "fill" | "fullscreen";
export type SpacePanelAnchor = "left" | "right";
export type SpacePanelChrome = "default" | "minimal";

export type SpaceChatLayoutConfig = {
  mode?: SpaceChatPanelMode;
  anchor?: SpacePanelAnchor;
  width?: number;
  collapsed?: boolean;
};

export type SpaceSidePanelLayoutConfig = {
  mode?: SpaceSidePanelMode;
  anchor?: SpacePanelAnchor;
  width?: number;
  collapsed?: boolean;
};

export type SpacePreviewLayoutConfig = {
  mode?: SpacePreviewPanelMode;
  chrome?: SpacePanelChrome;
  width?: number;
};

export type SpaceLayoutPanels = {
  chat?: SpaceChatLayoutConfig;
  files?: SpaceSidePanelLayoutConfig;
  preview?: SpacePreviewLayoutConfig;
  canvas?: SpacePreviewLayoutConfig;
  ports?: SpacePreviewLayoutConfig;
};

export type SpaceLayoutManifest = {
  version: SpaceLayoutVersion;
  panels?: SpaceLayoutPanels;
};

export type NormalizedSpaceLayout = {
  version: SpaceLayoutVersion;
  panels: {
    chat: Required<SpaceChatLayoutConfig>;
    files: Required<SpaceSidePanelLayoutConfig>;
    preview: Required<SpacePreviewLayoutConfig>;
    canvas: Required<SpacePreviewLayoutConfig>;
    ports: Required<SpacePreviewLayoutConfig>;
  };
};

export const SPACE_LAYOUT_WIDTH_LIMITS = {
  chat: { min: 320, max: 720 },
  files: { min: 260, max: 520 },
  preview: { min: 280, max: 1400 },
  canvas: { min: 280, max: 1400 },
  ports: { min: 280, max: 1400 },
} as const;

export const DEFAULT_SPACE_LAYOUT = {
  version: 1,
  panels: {
    chat: {
      mode: "main",
      anchor: "left",
      width: 420,
      collapsed: false,
    },
    files: {
      mode: "dock",
      anchor: "right",
      width: 320,
      collapsed: false,
    },
    preview: {
      mode: "dock",
      chrome: "default",
      width: 480,
    },
    canvas: {
      mode: "dock",
      chrome: "default",
      width: 480,
    },
    ports: {
      mode: "dock",
      chrome: "default",
      width: 480,
    },
  },
} satisfies NormalizedSpaceLayout;

type PanelId = keyof NormalizedSpaceLayout["panels"];

const CHAT_MODES = new Set<SpaceChatPanelMode>(["main", "floating", "hidden"]);
const SIDE_MODES = new Set<SpaceSidePanelMode>(["dock", "floating", "hidden"]);
const PREVIEW_MODES = new Set<SpacePreviewPanelMode>(["dock", "fill", "fullscreen"]);
const ANCHORS = new Set<SpacePanelAnchor>(["left", "right"]);
const CHROMES = new Set<SpacePanelChrome>(["default", "minimal"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function readWidth(value: unknown, panelId: PanelId) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const limits = SPACE_LAYOUT_WIDTH_LIMITS[panelId];
  return Math.round(clamp(value, limits.min, limits.max));
}

function readBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function readAnchor(value: unknown) {
  return typeof value === "string" && ANCHORS.has(value as SpacePanelAnchor)
    ? (value as SpacePanelAnchor)
    : undefined;
}

function normalizeChatPanel(value: unknown): SpaceChatLayoutConfig | undefined {
  if (!isRecord(value)) return undefined;
  const next: SpaceChatLayoutConfig = {};
  if (typeof value.mode === "string" && CHAT_MODES.has(value.mode as SpaceChatPanelMode)) next.mode = value.mode as SpaceChatPanelMode;
  const anchor = readAnchor(value.anchor);
  if (anchor) next.anchor = anchor;
  const width = readWidth(value.width, "chat");
  if (width !== undefined) next.width = width;
  const collapsed = readBoolean(value.collapsed);
  if (collapsed !== undefined) next.collapsed = collapsed;
  return Object.keys(next).length > 0 ? next : undefined;
}

function normalizeSidePanel(value: unknown): SpaceSidePanelLayoutConfig | undefined {
  if (!isRecord(value)) return undefined;
  const next: SpaceSidePanelLayoutConfig = {};
  if (typeof value.mode === "string" && SIDE_MODES.has(value.mode as SpaceSidePanelMode)) next.mode = value.mode as SpaceSidePanelMode;
  const anchor = readAnchor(value.anchor);
  if (anchor) next.anchor = anchor;
  const width = readWidth(value.width, "files");
  if (width !== undefined) next.width = width;
  const collapsed = readBoolean(value.collapsed);
  if (collapsed !== undefined) next.collapsed = collapsed;
  return Object.keys(next).length > 0 ? next : undefined;
}

function normalizePreviewPanel(value: unknown, panelId: "preview" | "canvas" | "ports"): SpacePreviewLayoutConfig | undefined {
  if (!isRecord(value)) return undefined;
  const next: SpacePreviewLayoutConfig = {};
  if (typeof value.mode === "string" && PREVIEW_MODES.has(value.mode as SpacePreviewPanelMode)) next.mode = value.mode as SpacePreviewPanelMode;
  if (typeof value.chrome === "string" && CHROMES.has(value.chrome as SpacePanelChrome)) next.chrome = value.chrome as SpacePanelChrome;
  const width = readWidth(value.width, panelId);
  if (width !== undefined) next.width = width;
  return Object.keys(next).length > 0 ? next : undefined;
}

export function normalizeSpaceLayoutManifest(input: unknown): SpaceLayoutManifest | null {
  if (!isRecord(input)) return null;
  const panelsInput = isRecord(input.panels) ? input.panels : {};
  const panels: SpaceLayoutPanels = {};

  const chat = normalizeChatPanel(panelsInput.chat);
  if (chat) panels.chat = chat;
  const files = normalizeSidePanel(panelsInput.files);
  if (files) panels.files = files;
  const preview = normalizePreviewPanel(panelsInput.preview, "preview");
  if (preview) panels.preview = preview;
  const canvas = normalizePreviewPanel(panelsInput.canvas, "canvas");
  if (canvas) panels.canvas = canvas;
  const ports = normalizePreviewPanel(panelsInput.ports, "ports");
  if (ports) panels.ports = ports;

  return {
    version: 1,
    ...(Object.keys(panels).length > 0 ? { panels } : {}),
  };
}

function cloneDefaultSpaceLayout(): NormalizedSpaceLayout {
  return {
    version: 1,
    panels: {
      chat: { ...DEFAULT_SPACE_LAYOUT.panels.chat },
      files: { ...DEFAULT_SPACE_LAYOUT.panels.files },
      preview: { ...DEFAULT_SPACE_LAYOUT.panels.preview },
      canvas: { ...DEFAULT_SPACE_LAYOUT.panels.canvas },
      ports: { ...DEFAULT_SPACE_LAYOUT.panels.ports },
    },
  };
}

export function mergeSpaceLayouts(...layouts: Array<SpaceLayoutManifest | NormalizedSpaceLayout | null | undefined>): NormalizedSpaceLayout {
  const result: NormalizedSpaceLayout = cloneDefaultSpaceLayout();
  for (const layout of layouts) {
    if (!layout?.panels) continue;
    for (const panelId of Object.keys(layout.panels) as PanelId[]) {
      const patch = layout.panels[panelId];
      if (!patch) continue;
      result.panels[panelId] = { ...result.panels[panelId], ...patch } as never;
    }
  }
  return result;
}

function compactPanel<T extends Record<string, unknown>>(panel: T, defaults: T): Partial<T> | undefined {
  const next: Partial<T> = {};
  for (const key of Object.keys(panel) as Array<keyof T>) {
    if (panel[key] !== defaults[key]) next[key] = panel[key];
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

export function compactSpaceLayout(layout: NormalizedSpaceLayout): SpaceLayoutManifest {
  const panels: SpaceLayoutPanels = {};
  const chat = compactPanel(layout.panels.chat, DEFAULT_SPACE_LAYOUT.panels.chat);
  if (chat) panels.chat = chat;
  const files = compactPanel(layout.panels.files, DEFAULT_SPACE_LAYOUT.panels.files);
  if (files) panels.files = files;
  const preview = compactPanel(layout.panels.preview, DEFAULT_SPACE_LAYOUT.panels.preview);
  if (preview) panels.preview = preview;
  const canvas = compactPanel(layout.panels.canvas, DEFAULT_SPACE_LAYOUT.panels.canvas);
  if (canvas) panels.canvas = canvas;
  const ports = compactPanel(layout.panels.ports, DEFAULT_SPACE_LAYOUT.panels.ports);
  if (ports) panels.ports = ports;
  return {
    version: 1,
    ...(Object.keys(panels).length > 0 ? { panels } : {}),
  };
}
