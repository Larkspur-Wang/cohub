import { resolveLogtoEndpoint } from "@cohub/auth";

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, "");

const env = process.env.ENV === "prod" ? "prod" : "dev";

export const gatewayConfig = {
  apiBaseUrl: normalizeBaseUrl(process.env.API_BASE_URL ?? "http://localhost:8787"),
  workerSecret: process.env.WORKER_SECRET ?? "",
  logtoEndpoint: resolveLogtoEndpoint({ endpoint: process.env.LOGTO_ENDPOINT, env }),
  port: Number(process.env.PORT ?? 8788),
};

export type GatewayAuthUser = {
  uuid: string;
  nick_name?: string;
  avatar_url?: string;
  [key: string]: unknown;
};
