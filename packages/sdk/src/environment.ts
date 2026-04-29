export type CohubEnvironment = "prod" | "dev";

export const COHUB_ENVIRONMENTS = {
  prod: {
    apiBaseUrl: "https://api.cohub.run",
    websocketUrl: "wss://gateway.cohub.run/ws",
  },
  dev: {
    apiBaseUrl: "https://api-dev.cohub.run",
    websocketUrl: "wss://gateway-dev.cohub.run/ws",
  },
} as const satisfies Record<CohubEnvironment, { apiBaseUrl: string; websocketUrl: string }>;

const readRuntimeEnv = (): string | undefined => {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };
  return runtime.process?.env?.ENV;
};

export const resolveCohubEnvironment = (env?: CohubEnvironment): CohubEnvironment => {
  if (env) return env;
  return readRuntimeEnv() === "dev" ? "dev" : "prod";
};

export const normalizeBaseUrl = (url: string) => url.trim().replace(/\/+$/, "");

export const normalizeWebsocketUrl = (input: string) => {
  const trimmed = normalizeBaseUrl(input);
  const withProtocol = trimmed
    .replace(/^http:/, "ws:")
    .replace(/^https:/, "wss:");
  return withProtocol.endsWith("/ws") ? withProtocol : `${withProtocol}/ws`;
};

export const resolveApiBaseUrl = (options: {
  baseUrl?: string;
  env?: CohubEnvironment;
} = {}) => {
  if (options.baseUrl) return normalizeBaseUrl(options.baseUrl);
  return COHUB_ENVIRONMENTS[resolveCohubEnvironment(options.env)].apiBaseUrl;
};

export const resolveWebsocketUrl = (options: {
  url?: string;
  env?: CohubEnvironment;
} = {}) => {
  if (options.url) return normalizeWebsocketUrl(options.url);
  return COHUB_ENVIRONMENTS[resolveCohubEnvironment(options.env)].websocketUrl;
};
