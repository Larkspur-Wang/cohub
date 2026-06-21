import crypto from "node:crypto";
import { createLogger } from "@cohub/infra/logging";
import {
  WECHAT_DEFAULT_BOT_AGENT,
  WECHAT_DEFAULT_BASE_URL,
  WeChatMessageItemType,
  WeChatMessageState,
  WeChatMessageType,
  type WeChatGetUpdatesResponse,
  type WeChatSendMessageRequest,
} from "./types.js";

const logger = createLogger({ serviceName: "cohub-gateway" });
const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const DEFAULT_API_TIMEOUT_MS = 15_000;
const WECHAT_ILINK_APP_ID = "bot";
const WECHAT_ILINK_APP_CLIENT_VERSION = "132099";

const ensureTrailingSlash = (value: string) => value.endsWith("/") ? value : `${value}/`;

const resolveWeChatBaseUrl = (value: string) => {
  try {
    const url = new URL(value || WECHAT_DEFAULT_BASE_URL);
    if (url.protocol === "https:" && (url.hostname === "ilinkai.weixin.qq.com" || url.hostname.endsWith(".weixin.qq.com"))) {
      return url.toString();
    }
  } catch {
    // fall through to default
  }
  return WECHAT_DEFAULT_BASE_URL;
};

const randomWechatUin = () => {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf-8").toString("base64");
};

const sanitizeBotAgent = (value: string | undefined) => {
  const trimmed = value?.trim();
  if (!trimmed) return WECHAT_DEFAULT_BOT_AGENT;
  if (!/^[\x20-\x7e]{1,256}$/.test(trimmed)) return WECHAT_DEFAULT_BOT_AGENT;
  return trimmed;
};

const buildHeaders = (token?: string) => ({
  "Content-Type": "application/json",
  AuthorizationType: "ilink_bot_token",
  "X-WECHAT-UIN": randomWechatUin(),
  "iLink-App-Id": WECHAT_ILINK_APP_ID,
  "iLink-App-ClientVersion": WECHAT_ILINK_APP_CLIENT_VERSION,
  ...(token?.trim() ? { Authorization: `Bearer ${token.trim()}` } : {}),
});

const withTimeoutSignal = (timeoutMs: number, externalSignal?: AbortSignal) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", onAbort);
    },
  };
};

async function postJson(params: {
  baseUrl: string;
  endpoint: string;
  token?: string;
  body: unknown;
  timeoutMs: number;
  signal?: AbortSignal;
  label: string;
}) {
  const { signal, cleanup } = withTimeoutSignal(params.timeoutMs, params.signal);
  try {
    const url = new URL(params.endpoint, ensureTrailingSlash(resolveWeChatBaseUrl(params.baseUrl)));
    const response = await fetch(url, {
      method: "POST",
      headers: buildHeaders(params.token),
      body: JSON.stringify(params.body),
      signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${params.label} failed ${response.status}: ${text.slice(0, 300)}`);
    return text;
  } finally {
    cleanup();
  }
}

export async function getWeChatUpdates(params: {
  baseUrl: string;
  token: string;
  getUpdatesBuf: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  botAgent?: string;
}): Promise<WeChatGetUpdatesResponse> {
  const timeoutMs = params.timeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS;
  try {
    const text = await postJson({
      baseUrl: params.baseUrl,
      endpoint: "ilink/bot/getupdates",
      token: params.token,
      timeoutMs,
      signal: params.signal,
      label: "wechat getUpdates",
      body: {
        get_updates_buf: params.getUpdatesBuf,
        base_info: { bot_agent: sanitizeBotAgent(params.botAgent) },
      },
    });
    return JSON.parse(text) as WeChatGetUpdatesResponse;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      if (params.signal?.aborted) throw error;
      return { ret: 0, msgs: [], get_updates_buf: params.getUpdatesBuf };
    }
    throw error;
  }
}

export async function sendWeChatTextMessage(params: {
  baseUrl: string;
  token: string;
  to: string;
  text: string;
  contextToken?: string | null;
  botAgent?: string;
}) {
  const clientId = crypto.randomUUID();
  const itemList = params.text.trim()
    ? [{ type: WeChatMessageItemType.TEXT, text_item: { text: params.text } }]
    : [];
  const body: WeChatSendMessageRequest & { base_info: { bot_agent: string } } = {
    msg: {
      from_user_id: "",
      to_user_id: params.to,
      client_id: clientId,
      message_type: WeChatMessageType.BOT,
      message_state: WeChatMessageState.FINISH,
      item_list: itemList.length ? itemList : undefined,
      context_token: params.contextToken?.trim() || undefined,
    },
    base_info: { bot_agent: sanitizeBotAgent(params.botAgent) },
  };

  if (!body.msg.context_token) {
    logger.warn(`[WeChat] sending without context token to=${params.to}`);
  }

  await postJson({
    baseUrl: params.baseUrl,
    endpoint: "ilink/bot/sendmessage",
    token: params.token,
    timeoutMs: DEFAULT_API_TIMEOUT_MS,
    label: "wechat sendMessage",
    body,
  });
  return { externalMessageId: clientId };
}
