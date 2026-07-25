export type BoardRenderCost = {
  particles: number;
  vertices: number;
  dynamicVertices: number;
  drawCalls: number;
  filterPasses: number;
  renderTexturePixels: number;
  textureBytes: number;
  bufferBytes: number;
  simulationSteps: number;
};

export type BoardCapability = {
  kind: "preset" | "clip" | "effect" | "shader";
  id: string;
  version: number;
  digest?: string;
  renderers?: Array<"webgpu" | "webgl">;
  fallbackId?: string;
  schema?: Record<string, unknown>;
};

export const DEFAULT_BOARD_RENDER_LIMITS: BoardRenderCost = {
  particles: 20_000,
  vertices: 500_000,
  dynamicVertices: 150_000,
  drawCalls: 400,
  filterPasses: 24,
  renderTexturePixels: 16_777_216,
  textureBytes: 512 * 1024 * 1024,
  bufferBytes: 256 * 1024 * 1024,
  simulationSteps: 100_000,
};

export const BOARD_BUILTIN_CLIP_KINDS = [
  "motion.keyframes",
  "motion.path",
  "draw.reveal",
  "draw.handwrite",
  "text.reveal",
  "effects.particles",
  "effects.trail",
  "effects.impact",
  "effects.flash",
  "effects.color",
  "camera.pan",
  "camera.zoom",
  "camera.shake",
] as const;

export const BOARD_BUILTIN_EFFECT_KINDS = [
  "effects.pulse",
  "effects.float",
] as const;

export const BOARD_BUILTIN_CAPABILITIES: BoardCapability[] = [
  ...BOARD_BUILTIN_CLIP_KINDS.map((id) => ({
    kind: "clip" as const,
    id,
    version: 1,
    renderers: ["webgpu", "webgl"] as Array<"webgpu" | "webgl">,
  })),
  ...BOARD_BUILTIN_EFFECT_KINDS.map((id) => ({
    kind: "effect" as const,
    id,
    version: 1,
    renderers: ["webgpu", "webgl"] as Array<"webgpu" | "webgl">,
  })),
];
