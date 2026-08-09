
export const WORK_SURFACE_PROTOCOL = "cohub.surface";
export const WORK_SURFACE_VERSION = 1;

export const WORK_SURFACE_READY_TIMEOUT_MS = 10_000;
export const WORK_SURFACE_REQUEST_TIMEOUT_MS = 15_000;

type SurfaceEnvelope = {
  protocol: typeof WORK_SURFACE_PROTOCOL;
  version: typeof WORK_SURFACE_VERSION;
};

export type WorkSurfaceReadyMessage = SurfaceEnvelope & {
  type: "ready";
  methods: string[];
};

export type WorkSurfaceRequestMessage = SurfaceEnvelope & {
  type: "request";
  requestId: string;
  method: string;
  input?: unknown;
};

export type WorkSurfaceResponseMessage = SurfaceEnvelope & {
  type: "response";
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
};

export type WorkSurfaceHostMessage = WorkSurfaceRequestMessage;
export type WorkSurfaceClientMessage = WorkSurfaceReadyMessage | WorkSurfaceResponseMessage;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const isSurfaceEnvelope = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) &&
  value.protocol === WORK_SURFACE_PROTOCOL &&
  value.version === WORK_SURFACE_VERSION;

export const parseWorkSurfaceReady = (value: unknown): WorkSurfaceReadyMessage | null => {
  if (!isSurfaceEnvelope(value) || value.type !== "ready") return null;
  const methods = Array.isArray(value.methods)
    ? value.methods.filter((method): method is string => typeof method === "string" && Boolean(method))
    : [];
  return {
    protocol: WORK_SURFACE_PROTOCOL,
    version: WORK_SURFACE_VERSION,
    type: "ready",
    methods,
  };
};

export const parseWorkSurfaceResponse = (value: unknown): WorkSurfaceResponseMessage | null => {
  if (!isSurfaceEnvelope(value) || value.type !== "response") return null;
  if (typeof value.requestId !== "string" || !value.requestId) return null;
  const error = isRecord(value.error)
    ? {
        code: typeof value.error.code === "string" && value.error.code ? value.error.code : "surface_error",
        message: typeof value.error.message === "string" ? value.error.message : "Work surface call failed",
      }
    : undefined;
  return {
    protocol: WORK_SURFACE_PROTOCOL,
    version: WORK_SURFACE_VERSION,
    type: "response",
    requestId: value.requestId,
    ok: value.ok === true,
    ...(value.result === undefined ? {} : { result: value.result }),
    ...(error ? { error } : {}),
  };
};

export const parseWorkSurfaceRequest = (value: unknown): WorkSurfaceRequestMessage | null => {
  if (!isSurfaceEnvelope(value) || value.type !== "request") return null;
  if (typeof value.requestId !== "string" || !value.requestId) return null;
  if (typeof value.method !== "string" || !value.method) return null;
  return {
    protocol: WORK_SURFACE_PROTOCOL,
    version: WORK_SURFACE_VERSION,
    type: "request",
    requestId: value.requestId,
    method: value.method,
    ...(value.input === undefined ? {} : { input: value.input }),
  };
};

export const buildWorkSurfaceReady = (methods: string[]): WorkSurfaceReadyMessage => ({
  protocol: WORK_SURFACE_PROTOCOL,
  version: WORK_SURFACE_VERSION,
  type: "ready",
  methods: [...methods],
});

export const buildWorkSurfaceRequest = (
  input: Omit<WorkSurfaceRequestMessage, keyof SurfaceEnvelope | "type">,
): WorkSurfaceRequestMessage => ({
  protocol: WORK_SURFACE_PROTOCOL,
  version: WORK_SURFACE_VERSION,
  type: "request",
  ...input,
});

export const buildWorkSurfaceResponse = (
  input: Omit<WorkSurfaceResponseMessage, keyof SurfaceEnvelope | "type">,
): WorkSurfaceResponseMessage => ({
  protocol: WORK_SURFACE_PROTOCOL,
  version: WORK_SURFACE_VERSION,
  type: "response",
  ...input,
});
