import { resolveLogtoEndpoint } from "@cohub/identity";

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, "");

const env = process.env.ENV === "prod" ? "prod" : "dev";

export const gatewayConfig = {
  apiBaseUrl: normalizeBaseUrl(process.env.API_BASE_URL ?? "http://localhost:8787"),
  workerSecret: process.env.WORKER_SECRET ?? "",
  logtoEndpoint: resolveLogtoEndpoint({ endpoint: process.env.LOGTO_ENDPOINT, env }),
  port: Number(process.env.PORT ?? 8788),
  volcAsr: {
    apiKey: process.env.VOLC_ASR_API_KEY ?? "",
    resourceId: process.env.VOLC_ASR_RESOURCE_ID ?? "volc.seedasr.sauc.concurrent",
    url: process.env.VOLC_ASR_WS_URL ?? "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async",
  },
};

export type GatewayAuthUser = {
  uuid: string;
  nick_name?: string;
  avatar_url?: string;
  [key: string]: unknown;
};
