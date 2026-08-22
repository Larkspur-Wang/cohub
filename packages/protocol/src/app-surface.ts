import { parseDesktopCommandId } from "./desktop-command.js";

export const APP_SURFACE_PROTOCOL = "cohub.app.surface";
export const APP_SURFACE_VERSION = 1;

export const APP_SURFACE_READY_TIMEOUT_MS = 10_000;
export const APP_SURFACE_REQUEST_TIMEOUT_MS = 15_000;
export const APP_COMPOSER_CHIP_KEY_MAX_LENGTH = 80;
export const APP_COMPOSER_CHIP_LABEL_MAX_LENGTH = 120;
export const APP_COMPOSER_CHIP_CONTENT_MAX_BYTES = 32 * 1024;

type SurfaceEnvelope = {
  protocol: typeof APP_SURFACE_PROTOCOL;
  version: typeof APP_SURFACE_VERSION;
};

export type AppSurfaceReadyMessage = SurfaceEnvelope & {
  type: "ready";
  methods: string[];
};

export type AppSurfaceRequestMessage = SurfaceEnvelope & {
  type: "request";
  requestId: string;
  method: string;
  input?: unknown;
  /** The originating desktop command that the app will complete. */
  commandId: string;
};

export type AppSurfaceResponseMessage = SurfaceEnvelope & {
  type: "response";
  requestId: string;
  ok: boolean;
  error?: { code: string; message: string };
};

export type AppComposerChip = {
  key: string;
  label: string;
  content: string;
};

export type AppComposerChipSetMessage = SurfaceEnvelope & {
  type: "composer.chip.set";
  chip: AppComposerChip;
};

export type AppComposerChipClearMessage = SurfaceEnvelope & {
  type: "composer.chip.clear";
  key: string;
};

export type AppSurfaceHostMessage = AppSurfaceRequestMessage;
export type AppSurfaceClientMessage =
  | AppSurfaceReadyMessage
  | AppSurfaceResponseMessage
  | AppComposerChipSetMessage
  | AppComposerChipClearMessage;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const isSurfaceEnvelope = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) &&
  value.protocol === APP_SURFACE_PROTOCOL &&
  value.version === APP_SURFACE_VERSION;

export const parseAppSurfaceReady = (value: unknown): AppSurfaceReadyMessage | null => {
  if (!isSurfaceEnvelope(value) || value.type !== "ready") return null;
  const methods = Array.isArray(value.methods)
    ? value.methods.filter((method): method is string => typeof method === "string" && Boolean(method))
    : [];
  return {
    protocol: APP_SURFACE_PROTOCOL,
    version: APP_SURFACE_VERSION,
    type: "ready",
    methods,
  };
};

export const parseAppSurfaceResponse = (value: unknown): AppSurfaceResponseMessage | null => {
  if (!isSurfaceEnvelope(value) || value.type !== "response") return null;
  if (typeof value.requestId !== "string" || !value.requestId) return null;
  const error = isRecord(value.error)
    ? {
        code: typeof value.error.code === "string" && value.error.code ? value.error.code : "surface_error",
        message: typeof value.error.message === "string" ? value.error.message : "App surface call failed",
      }
    : undefined;
  return {
    protocol: APP_SURFACE_PROTOCOL,
    version: APP_SURFACE_VERSION,
    type: "response",
    requestId: value.requestId,
    ok: value.ok === true,
    ...(error ? { error } : {}),
  };
};

const parseComposerChipKey = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const key = value.trim();
  if (!key || key.length > APP_COMPOSER_CHIP_KEY_MAX_LENGTH) return null;
  return key;
};

export const parseAppComposerChipSet = (value: unknown): AppComposerChipSetMessage | null => {
  if (!isSurfaceEnvelope(value) || value.type !== "composer.chip.set" || !isRecord(value.chip)) {
    return null;
  }
  const key = parseComposerChipKey(value.chip.key);
  if (!key || typeof value.chip.label !== "string" || typeof value.chip.content !== "string") {
    return null;
  }
  const label = value.chip.label.trim();
  if (!label || label.length > APP_COMPOSER_CHIP_LABEL_MAX_LENGTH) return null;
  if (!value.chip.content.trim()) return null;
  if (new TextEncoder().encode(value.chip.content).length > APP_COMPOSER_CHIP_CONTENT_MAX_BYTES) {
    return null;
  }
  return {
    protocol: APP_SURFACE_PROTOCOL,
    version: APP_SURFACE_VERSION,
    type: "composer.chip.set",
    chip: { key, label, content: value.chip.content },
  };
};

export const parseAppComposerChipClear = (value: unknown): AppComposerChipClearMessage | null => {
  if (!isSurfaceEnvelope(value) || value.type !== "composer.chip.clear") return null;
  const key = parseComposerChipKey(value.key);
  return key
    ? {
        protocol: APP_SURFACE_PROTOCOL,
        version: APP_SURFACE_VERSION,
        type: "composer.chip.clear",
        key,
      }
    : null;
};

export const parseAppSurfaceRequest = (value: unknown): AppSurfaceRequestMessage | null => {
  if (!isSurfaceEnvelope(value) || value.type !== "request") return null;
  if (typeof value.requestId !== "string" || !value.requestId) return null;
  if (typeof value.method !== "string" || !value.method) return null;
  const commandId = parseDesktopCommandId(value.commandId);
  if (!commandId) return null;
  return {
    protocol: APP_SURFACE_PROTOCOL,
    version: APP_SURFACE_VERSION,
    type: "request",
    requestId: value.requestId,
    method: value.method,
    ...(value.input === undefined ? {} : { input: value.input }),
    commandId,
  };
};

export const buildAppSurfaceReady = (methods: string[]): AppSurfaceReadyMessage => ({
  protocol: APP_SURFACE_PROTOCOL,
  version: APP_SURFACE_VERSION,
  type: "ready",
  methods: [...methods],
});

export const buildAppSurfaceRequest = (
  input: Omit<AppSurfaceRequestMessage, keyof SurfaceEnvelope | "type">,
): AppSurfaceRequestMessage => ({
  protocol: APP_SURFACE_PROTOCOL,
  version: APP_SURFACE_VERSION,
  type: "request",
  ...input,
});

export const buildAppSurfaceResponse = (
  input: Omit<AppSurfaceResponseMessage, keyof SurfaceEnvelope | "type">,
): AppSurfaceResponseMessage => ({
  protocol: APP_SURFACE_PROTOCOL,
  version: APP_SURFACE_VERSION,
  type: "response",
  ...input,
});

export const buildAppComposerChipSet = (chip: AppComposerChip): AppComposerChipSetMessage => ({
  protocol: APP_SURFACE_PROTOCOL,
  version: APP_SURFACE_VERSION,
  type: "composer.chip.set",
  chip,
});

export const buildAppComposerChipClear = (key: string): AppComposerChipClearMessage => ({
  protocol: APP_SURFACE_PROTOCOL,
  version: APP_SURFACE_VERSION,
  type: "composer.chip.clear",
  key,
});
