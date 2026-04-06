const normalizeBaseUrl = (value: string) => value.replace(/\/$/, "");

export const gatewayConfig = {
  apiBaseUrl: normalizeBaseUrl(process.env.API_BASE_URL ?? "http://localhost:8787"),
  port: Number(process.env.PORT ?? 8788),
};

export type GatewayAuthUser = {
  uuid: string;
  nick_name?: string;
  avatar_url?: string;
  [key: string]: unknown;
};
