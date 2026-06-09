export const SPACE_LAYOUT_MANIFEST_PATH = ".cohub/space.layout.json";

export type SpaceLayoutVersion = 2;
export type SpaceLayoutComponentType =
  | "chat"
  | "fileBrowser"
  | "fileViewer"
  | "canvas"
  | "portsPreview"
  | "spaceProfile"
  | "custom";
export type SpaceLayoutPlacementMode = "dock" | "floating" | "fullscreen" | "hidden";
export type SpaceLayoutEdge = "left" | "right" | "top" | "bottom";
export type SpaceLayoutAnchor = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type SpaceLayoutUnit = "px" | "ratio";
export type SpaceLayoutChromeVariant = "default" | "minimal" | "bare";
export type SpaceLayoutShadow = "none" | "soft" | "medium";
export type SpaceRuntimeSystemBarVisibility = "always" | "immersiveOnly";
export type SpaceRuntimeSystemBarPlacement = "floating" | "top" | "right" | "bottom" | "left";
export type SpaceRuntimeSystemBarPosition = SpaceLayoutAnchor;

export type SpaceLayoutPosition = {
  x: number;
  y: number;
  unit?: SpaceLayoutUnit;
};

export type SpaceLayoutPlacement =
  | {
      mode: "dock";
      edge?: SpaceLayoutEdge;
      order?: number;
    }
  | {
      mode: "floating";
      anchor?: SpaceLayoutAnchor;
      position?: SpaceLayoutPosition;
      z?: number;
    }
  | { mode: "fullscreen" }
  | { mode: "hidden" };

export type SpaceLayoutSize = {
  width?: number;
  height?: number;
  unit?: SpaceLayoutUnit;
};

export type SpaceLayoutConstraints = {
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
};

export type SpaceLayoutChrome = {
  variant?: SpaceLayoutChromeVariant;
  header?: boolean;
  border?: boolean;
  shadow?: SpaceLayoutShadow;
};

export type SpaceLayoutComponent = {
  id: string;
  type: SpaceLayoutComponentType;
  title?: string;
  placement: SpaceLayoutPlacement;
  size?: SpaceLayoutSize;
  constraints?: SpaceLayoutConstraints;
  chrome?: SpaceLayoutChrome;
};

export type SpaceRuntimeSystemBarContent = {
  brand?: boolean;
  spaceProfile?: boolean;
  defaultLayout?: boolean;
};

export type SpaceRuntimeSystemBar = {
  visibility?: SpaceRuntimeSystemBarVisibility;
  placement?: SpaceRuntimeSystemBarPlacement;
  position?: SpaceRuntimeSystemBarPosition;
  content?: SpaceRuntimeSystemBarContent;
};

export type SpaceLayoutManifest = {
  version: SpaceLayoutVersion;
  name?: string;
  layout?: {
    canvas?: {
      background?: "default";
      density?: "compact" | "comfortable";
    };
    components?: SpaceLayoutComponent[];
  };
  runtime?: {
    systemBar?: SpaceRuntimeSystemBar;
  };
};

export type NormalizedSpaceLayout = Required<Pick<SpaceLayoutManifest, "version">> & {
  name: string;
  layout: {
    canvas: {
      background: "default";
      density: "compact" | "comfortable";
    };
    components: SpaceLayoutComponent[];
  };
  runtime: {
    systemBar: Required<Omit<SpaceRuntimeSystemBar, "content">> & {
      content: Required<SpaceRuntimeSystemBarContent>;
    };
  };
};

export type SpaceLayoutPanelId = "chat" | "fileBrowser" | "fileViewer" | "canvas" | "portsPreview";

const COMPONENT_TYPES = new Set<SpaceLayoutComponentType>([
  "chat",
  "fileBrowser",
  "fileViewer",
  "canvas",
  "portsPreview",
  "spaceProfile",
  "custom",
]);
const PLACEMENT_MODES = new Set<SpaceLayoutPlacementMode>(["dock", "floating", "fullscreen", "hidden"]);
const EDGES = new Set<SpaceLayoutEdge>(["left", "right", "top", "bottom"]);
const ANCHORS = new Set<SpaceLayoutAnchor>(["top-left", "top-right", "bottom-left", "bottom-right"]);
const UNITS = new Set<SpaceLayoutUnit>(["px", "ratio"]);
const CHROME_VARIANTS = new Set<SpaceLayoutChromeVariant>(["default", "minimal", "bare"]);
const SHADOWS = new Set<SpaceLayoutShadow>(["none", "soft", "medium"]);
const SYSTEM_BAR_VISIBILITIES = new Set<SpaceRuntimeSystemBarVisibility>(["always", "immersiveOnly"]);
const SYSTEM_BAR_PLACEMENTS = new Set<SpaceRuntimeSystemBarPlacement>(["floating", "top", "right", "bottom", "left"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function finiteInteger(value: unknown) {
  const number = finiteNumber(value);
  return number === undefined ? undefined : Math.round(number);
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function enumValue<T extends string>(value: unknown, values: Set<T>) {
  return typeof value === "string" && values.has(value as T) ? (value as T) : undefined;
}

function normalizePosition(value: unknown): SpaceLayoutPosition | undefined {
  if (!isRecord(value)) return undefined;
  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);
  if (x === undefined || y === undefined) return undefined;
  return {
    x,
    y,
    unit: enumValue(value.unit, UNITS) ?? "ratio",
  };
}

function normalizePlacement(value: unknown): SpaceLayoutPlacement | undefined {
  if (!isRecord(value)) return undefined;
  const mode = enumValue(value.mode, PLACEMENT_MODES);
  if (!mode) return undefined;
  if (mode === "dock") {
    return {
      mode,
      edge: enumValue(value.edge, EDGES) ?? "right",
      ...(finiteInteger(value.order) !== undefined ? { order: finiteInteger(value.order) } : {}),
    };
  }
  if (mode === "floating") {
    return {
      mode,
      anchor: enumValue(value.anchor, ANCHORS) ?? "top-right",
      ...(normalizePosition(value.position) ? { position: normalizePosition(value.position) } : {}),
      ...(finiteInteger(value.z) !== undefined ? { z: finiteInteger(value.z) } : {}),
    };
  }
  return { mode };
}

function normalizeSize(value: unknown): SpaceLayoutSize | undefined {
  if (!isRecord(value)) return undefined;
  const width = finiteNumber(value.width);
  const height = finiteNumber(value.height);
  const unit = enumValue(value.unit, UNITS) ?? "px";
  const next: SpaceLayoutSize = { unit };
  if (width !== undefined) next.width = width;
  if (height !== undefined) next.height = height;
  return width !== undefined || height !== undefined ? next : undefined;
}

function normalizeConstraints(value: unknown): SpaceLayoutConstraints | undefined {
  if (!isRecord(value)) return undefined;
  const next: SpaceLayoutConstraints = {};
  const minWidth = finiteNumber(value.minWidth);
  const minHeight = finiteNumber(value.minHeight);
  const maxWidth = finiteNumber(value.maxWidth);
  const maxHeight = finiteNumber(value.maxHeight);
  if (minWidth !== undefined) next.minWidth = minWidth;
  if (minHeight !== undefined) next.minHeight = minHeight;
  if (maxWidth !== undefined) next.maxWidth = maxWidth;
  if (maxHeight !== undefined) next.maxHeight = maxHeight;
  return Object.keys(next).length ? next : undefined;
}

function normalizeChrome(value: unknown): SpaceLayoutChrome | undefined {
  if (!isRecord(value)) return undefined;
  const next: SpaceLayoutChrome = {};
  const variant = enumValue(value.variant, CHROME_VARIANTS);
  const header = booleanValue(value.header);
  const border = booleanValue(value.border);
  const shadow = enumValue(value.shadow, SHADOWS);
  if (variant) next.variant = variant;
  if (header !== undefined) next.header = header;
  if (border !== undefined) next.border = border;
  if (shadow) next.shadow = shadow;
  return Object.keys(next).length ? next : undefined;
}

function normalizeComponent(value: unknown): SpaceLayoutComponent | undefined {
  if (!isRecord(value)) return undefined;
  const id = stringValue(value.id);
  const type = enumValue(value.type, COMPONENT_TYPES);
  const placement = normalizePlacement(value.placement);
  if (!id || !type || !placement) return undefined;
  return {
    id,
    type,
    ...(stringValue(value.title) ? { title: stringValue(value.title) } : {}),
    placement,
    ...(normalizeSize(value.size) ? { size: normalizeSize(value.size) } : {}),
    ...(normalizeConstraints(value.constraints) ? { constraints: normalizeConstraints(value.constraints) } : {}),
    ...(normalizeChrome(value.chrome) ? { chrome: normalizeChrome(value.chrome) } : {}),
  };
}

function normalizeSystemBar(value: unknown): SpaceRuntimeSystemBar | undefined {
  if (!isRecord(value)) return undefined;
  const contentInput = isRecord(value.content) ? value.content : {};
  return {
    ...(enumValue(value.visibility, SYSTEM_BAR_VISIBILITIES) ? { visibility: enumValue(value.visibility, SYSTEM_BAR_VISIBILITIES) } : {}),
    ...(enumValue(value.placement, SYSTEM_BAR_PLACEMENTS) ? { placement: enumValue(value.placement, SYSTEM_BAR_PLACEMENTS) } : {}),
    ...(enumValue(value.position, ANCHORS) ? { position: enumValue(value.position, ANCHORS) } : {}),
    content: {
      ...(booleanValue(contentInput.brand) !== undefined ? { brand: booleanValue(contentInput.brand) } : {}),
      ...(booleanValue(contentInput.spaceProfile) !== undefined ? { spaceProfile: booleanValue(contentInput.spaceProfile) } : {}),
      ...(booleanValue(contentInput.defaultLayout) !== undefined ? { defaultLayout: booleanValue(contentInput.defaultLayout) } : {}),
    },
  };
}

export const DEFAULT_SPACE_LAYOUT = {
  version: 2,
  name: "Default",
  layout: {
    canvas: {
      background: "default",
      density: "compact",
    },
    components: [
      {
        id: "chat",
        type: "chat",
        title: "Chat",
        placement: { mode: "dock", edge: "left", order: 10 },
        size: { width: 420, unit: "px" },
        constraints: { minWidth: 280, minHeight: 240 },
        chrome: { variant: "default", header: true, border: true, shadow: "none" },
      },
      {
        id: "file-viewer",
        type: "fileViewer",
        title: "File viewer",
        placement: { mode: "dock", edge: "right", order: 20 },
        size: { width: 480, unit: "px" },
        constraints: { minWidth: 280, minHeight: 240 },
        chrome: { variant: "default", header: true, border: true, shadow: "none" },
      },
      {
        id: "canvas",
        type: "canvas",
        title: "Canvas",
        placement: { mode: "dock", edge: "right", order: 21 },
        size: { width: 480, unit: "px" },
        constraints: { minWidth: 280, minHeight: 240 },
        chrome: { variant: "default", header: true, border: true, shadow: "none" },
      },
      {
        id: "ports-preview",
        type: "portsPreview",
        title: "Ports preview",
        placement: { mode: "dock", edge: "right", order: 22 },
        size: { width: 480, unit: "px" },
        constraints: { minWidth: 280, minHeight: 240 },
        chrome: { variant: "default", header: true, border: true, shadow: "none" },
      },
      {
        id: "file-browser",
        type: "fileBrowser",
        title: "File browser",
        placement: { mode: "dock", edge: "right", order: 30 },
        size: { width: 320, unit: "px" },
        constraints: { minWidth: 220, minHeight: 240 },
        chrome: { variant: "default", header: true, border: true, shadow: "none" },
      },
    ],
  },
  runtime: {
    systemBar: {
      visibility: "immersiveOnly",
      placement: "floating",
      position: "top-right",
      content: {
        brand: true,
        spaceProfile: true,
        defaultLayout: true,
      },
    },
  },
} satisfies NormalizedSpaceLayout;

function cloneDefaultSpaceLayout(): NormalizedSpaceLayout {
  return JSON.parse(JSON.stringify(DEFAULT_SPACE_LAYOUT)) as NormalizedSpaceLayout;
}

export function normalizeSpaceLayoutManifest(input: unknown): SpaceLayoutManifest | null {
  if (!isRecord(input)) return null;
  const layoutInput = isRecord(input.layout) ? input.layout : {};
  const canvasInput = isRecord(layoutInput.canvas) ? layoutInput.canvas : {};
  const componentsInput = Array.isArray(layoutInput.components) ? layoutInput.components : [];
  const components = componentsInput.map(normalizeComponent).filter((item): item is SpaceLayoutComponent => Boolean(item));
  const runtimeInput = isRecord(input.runtime) ? input.runtime : {};
  const systemBar = normalizeSystemBar(runtimeInput.systemBar);
  return {
    version: 2,
    ...(stringValue(input.name) ? { name: stringValue(input.name) } : {}),
    layout: {
      canvas: {
        background: "default",
        density: canvasInput.density === "comfortable" ? "comfortable" : "compact",
      },
      ...(components.length ? { components } : {}),
    },
    ...(systemBar ? { runtime: { systemBar } } : {}),
  };
}

export function normalizeSpaceLayout(input: unknown): NormalizedSpaceLayout {
  const manifest = normalizeSpaceLayoutManifest(input);
  const result = cloneDefaultSpaceLayout();
  if (!manifest) return result;
  result.name = manifest.name ?? result.name;
  result.layout.canvas = { ...result.layout.canvas, ...manifest.layout?.canvas };
  if (manifest.layout?.components?.length) result.layout.components = manifest.layout.components;
  const systemBar = manifest.runtime?.systemBar;
  if (systemBar) {
    result.runtime.systemBar = {
      ...result.runtime.systemBar,
      ...systemBar,
      content: {
        ...result.runtime.systemBar.content,
        ...systemBar.content,
      },
    };
  }
  return result;
}

export function compactSpaceLayout(layout: NormalizedSpaceLayout | SpaceLayoutManifest): SpaceLayoutManifest {
  const normalized = normalizeSpaceLayout(layout);
  return {
    version: 2,
    name: normalized.name,
    layout: normalized.layout,
    runtime: normalized.runtime,
  };
}

export function getSpaceLayoutComponent(
  layout: NormalizedSpaceLayout,
  type: SpaceLayoutComponentType,
): SpaceLayoutComponent | undefined {
  return layout.layout.components.find((component) => component.type === type);
}

export function getSpaceLayoutPanelComponent(
  layout: NormalizedSpaceLayout,
  panelId: SpaceLayoutPanelId,
): SpaceLayoutComponent | undefined {
  const type = panelId === "fileViewer" ? "fileViewer" : panelId;
  return getSpaceLayoutComponent(layout, type);
}
