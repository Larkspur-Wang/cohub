import { desc, eq } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  createCachedModelsConfig,
  getUserModelsRedisKey,
  mergeModelsConfigs,
  MODELS_CACHE_TTL_SEC,
  parseCachedModelsConfig,
  parseModelsConfig,
  PLATFORM_MODELS_REDIS_KEY,
  type ModelsConfig,
} from "@cohub/infra/config-runtime/models";
import type { ContentBlock } from "@cohub/protocol/core";
import type { GatewayChannelCommand, GatewayChannelCommandName, GatewayInboundEvent } from "@cohub/protocol/gateway";
import { config } from "./config.js";
import { db } from "./db/index.js";
import { sessionMessages, spaces } from "@cohub/db";
import { buildSessionSourceChannel } from "./lib/session-source-channel.js";
import { assignSessionSourceSystemLabel } from "@cohub/core/labels/session-source";
import { dispatchLabelAssignmentsUpdated } from "./realtime-events.js";
import { createLogger } from "@cohub/infra/logging";
import { redisCommandClient } from "./redis.js";
import { registerSpaceSession } from "./space-sessions.js";

const logger = createLogger({ serviceName: "cohub-api" });

type ResolvedGatewayInbound = {
  spaceId: string;
  sessionId: string;
  userId: string;
  spaceChannelId: string;
  conversationId: string;
  bindingKey: string;
};

export type ChannelCommandDeps = {
  buildDefaultBindingMeta: (event: GatewayInboundEvent) => Record<string, unknown>;
  createProviderMessageRef: (input: {
    provider: string;
    spaceId: string;
    spaceSessionId: string;
    spaceChannelId?: string | null;
    sessionMessageId?: string | null;
    direction: "inbound" | "outbound";
    externalConversationId: string;
    externalMessageId: string;
    parentExternalConversationId?: string | null;
    parentExternalMessageId?: string | null;
    externalAuthorId?: string | null;
    externalAuthorName?: string | null;
    meta?: Record<string, unknown> | null;
  }) => Promise<unknown>;
  createSpaceSessionBinding: (input: {
    spaceId: string;
    spaceSessionId: string;
    spaceChannelId: string;
    provider: string;
    bindingKey: string;
    externalChatId: string;
    meta?: Record<string, unknown> | null;
  }) => Promise<unknown>;
  dispatchOutboundMessage: (input: {
    spaceChannelId: string;
    spaceId?: string;
    spaceSessionId?: string;
    sessionMessageId?: string;
    provider?: string;
    externalChatId?: string | null;
    content: ContentBlock[];
    replyToExternalMessageId?: string;
    meta?: Record<string, unknown> | null;
  }) => Promise<void>;
};

type ChannelCommandExecutionInput = {
  event: GatewayInboundEvent;
  resolved: ResolvedGatewayInbound;
  command: GatewayChannelCommand;
  deps: ChannelCommandDeps;
};

type ChannelCommandHandler = (input: ChannelCommandExecutionInput) => Promise<boolean>;

const DEFAULT_MODEL_CONTEXT_WINDOW = 128_000;
const PLATFORM_MODELS_PATH = join(config.platformConfigRoot, "platform", ".cohub", "models.json");
const getUserModelsPath = (userId: string) => join(config.platformConfigRoot, "users", userId, ".cohub", "models.json");

const getSessionUrl = (spaceId: string, sessionId: string) => {
  const origin = (config.webOrigin ?? (config.env === "prod" ? "https://cohub.run" : "https://dev.cohub.run")).replace(/\/+$/, "");
  return `${origin}/spaces/${spaceId}/sessions/${sessionId}`;
};

const loadModelsConfig = async (input: {
  redisKey: string;
  modelsPath: string;
  allowMissing: boolean;
}): Promise<ModelsConfig | null> => {
  const cached = await redisCommandClient.get(input.redisKey);
  if (cached) {
    const parsed = parseCachedModelsConfig(cached);
    if (parsed) return parsed.content;
  }

  let rawText: string;
  try {
    rawText = await readFile(input.modelsPath, "utf-8");
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : undefined;
    if (code === "ENOENT" && input.allowMissing) {
      const missing = createCachedModelsConfig({ content: null });
      await redisCommandClient.set(input.redisKey, JSON.stringify(missing), "EX", MODELS_CACHE_TTL_SEC).catch(() => undefined);
      return null;
    }
    throw error;
  }

  const content = parseModelsConfig(rawText);
  const cacheValue = createCachedModelsConfig({ rawText, content });
  await redisCommandClient.set(input.redisKey, JSON.stringify(cacheValue), "EX", MODELS_CACHE_TTL_SEC).catch(() => undefined);
  return content;
};

const getModelContextWindow = async (spaceId: string, provider?: string | null, model?: string | null) => {
  const modelId = model?.trim();
  if (!modelId) return DEFAULT_MODEL_CONTEXT_WINDOW;

  const [space] = await db.select({ userUuid: spaces.userUuid }).from(spaces).where(eq(spaces.id, spaceId)).limit(1);
  const platformModels = await loadModelsConfig({
    redisKey: PLATFORM_MODELS_REDIS_KEY,
    modelsPath: PLATFORM_MODELS_PATH,
    allowMissing: false,
  });
  const userModels = space?.userUuid
    ? await loadModelsConfig({
        redisKey: getUserModelsRedisKey(space.userUuid),
        modelsPath: getUserModelsPath(space.userUuid),
        allowMissing: true,
      })
    : null;

  const catalog = mergeModelsConfigs(platformModels, userModels);
  const providers = provider?.trim()
    ? [[provider.trim(), catalog.providers[provider.trim()]] as const]
    : Object.entries(catalog.providers);

  for (const [, providerConfig] of providers) {
    const modelDef = providerConfig?.models?.find((item) => item.id === modelId);
    if (typeof modelDef?.contextWindow === "number" && Number.isFinite(modelDef.contextWindow) && modelDef.contextWindow > 0) {
      return modelDef.contextWindow;
    }
  }

  return DEFAULT_MODEL_CONTEXT_WINDOW;
};

const getUsageTotalTokens = (usage: unknown) => {
  if (!usage || typeof usage !== "object") return null;
  const record = usage as Record<string, unknown>;
  const explicit = record.totalTokens ?? record.total;
  if (typeof explicit === "number" && Number.isFinite(explicit)) return explicit;

  const input = typeof record.input === "number" ? record.input : 0;
  const output = typeof record.output === "number" ? record.output : 0;
  const cacheRead = typeof record.cacheRead === "number" ? record.cacheRead : 0;
  const cacheWrite = typeof record.cacheWrite === "number" ? record.cacheWrite : 0;
  const total = input + output + cacheRead + cacheWrite;
  return total > 0 ? total : null;
};

const formatTokenCount = (value: number) => {
  if (value < 1000) return String(Math.round(value));
  const thousands = value / 1000;
  if (thousands < 10 && !Number.isInteger(thousands)) return `${thousands.toFixed(1)}k`;
  return `${Math.round(thousands)}k`;
};

const getContextUsageText = async (spaceId: string, provider?: string | null, model?: string | null, usage?: unknown) => {
  const usedTokens = getUsageTotalTokens(usage) ?? 0;
  const contextWindow = await getModelContextWindow(spaceId, provider, model).catch(() => DEFAULT_MODEL_CONTEXT_WINDOW);
  return `${formatTokenCount(usedTokens)}/${formatTokenCount(contextWindow)}`;
};

const createInboundCommandRef = async (input: {
  deps: ChannelCommandDeps;
  event: GatewayInboundEvent;
  resolved: ResolvedGatewayInbound;
  command: GatewayChannelCommand;
  sessionId?: string;
}) => input.deps.createProviderMessageRef({
  provider: input.event.provider,
  spaceId: input.resolved.spaceId,
  spaceSessionId: input.sessionId ?? input.resolved.sessionId,
  spaceChannelId: input.resolved.spaceChannelId,
  sessionMessageId: null,
  direction: "inbound",
  externalConversationId: input.resolved.conversationId,
  externalMessageId: input.event.externalMessageId,
  externalAuthorId: input.event.sender.id,
  externalAuthorName: input.event.sender.name ?? null,
  meta: {
    bindingKey: input.resolved.bindingKey,
    command: input.command.name,
    contextIncluded: false,
  },
});

const dispatchCommandReply = async (input: {
  deps: ChannelCommandDeps;
  event: GatewayInboundEvent;
  resolved: ResolvedGatewayInbound;
  sessionId: string;
  text: string;
}) => input.deps.dispatchOutboundMessage({
  spaceChannelId: input.resolved.spaceChannelId,
  spaceId: input.resolved.spaceId,
  spaceSessionId: input.sessionId,
  provider: input.event.provider,
  externalChatId: input.event.externalChatId,
  replyToExternalMessageId: input.event.externalMessageId,
  content: [{ type: "text", text: input.text }],
  meta: {
    bindingKey: input.resolved.bindingKey,
    source: "channel_command",
    commandReply: true,
  },
});

const getSessionStatusText = async (spaceId: string, sessionId: string) => {
  const latestMessages = await db
    .select({ provider: sessionMessages.provider, model: sessionMessages.model, usage: sessionMessages.usage })
    .from(sessionMessages)
    .where(eq(sessionMessages.sessionId, sessionId))
    .orderBy(desc(sessionMessages.sequence))
    .limit(20);
  const latestModelMessage = latestMessages.find((message) => message.model?.trim());

  const modelText = latestModelMessage?.model
    ? `${latestModelMessage.provider ?? "unknown"}/${latestModelMessage.model}`
    : "unknown";
  const latestUsageMessage = latestMessages.find((message) => getUsageTotalTokens(message.usage) !== null);

  return [
    `Model: ${modelText}`,
    `Context: ${await getContextUsageText(spaceId, latestModelMessage?.provider, latestModelMessage?.model, latestUsageMessage?.usage)}`,
    `Session: ${sessionId}`,
    `Cohub: ${getSessionUrl(spaceId, sessionId)}`,
  ].join("\n");
};

const createFreshSessionForBinding = async (
  deps: ChannelCommandDeps,
  event: GatewayInboundEvent,
  resolved: ResolvedGatewayInbound,
) => {
  const sessionId = randomUUID();
  const sessionSource = buildSessionSourceChannel(event);
  const session = await registerSpaceSession({
    spaceId: resolved.spaceId,
    sessionId,
    userUuid: resolved.userId,
    source: sessionSource,
    externalSessionId: null,
    meta: {
      source: `channel:${event.provider}`,
      createdFrom: "gateway_command_new",
      conversation: event.conversation ?? null,
      providerMeta: event.meta ?? null,
      previousSessionId: resolved.sessionId,
    },
  });

  await assignSessionSourceSystemLabel({
    db,
    spaceId: resolved.spaceId,
    sessionId: session.id,
    source: sessionSource,
    provider: event.provider,
  }).then(() =>
    dispatchLabelAssignmentsUpdated({ spaceId: resolved.spaceId, resourceType: "session", resourceRef: session.id, sessionId: session.id }),
  ).catch((error) => logger.warn("[SessionSourceLabel] failed to assign channel source label", error));

  const defaultBindingMeta = deps.buildDefaultBindingMeta(event);
  await deps.createSpaceSessionBinding({
    spaceId: resolved.spaceId,
    spaceSessionId: session.id,
    spaceChannelId: resolved.spaceChannelId,
    provider: event.provider,
    bindingKey: resolved.bindingKey,
    externalChatId: event.externalChatId,
    meta: {
      ...defaultBindingMeta,
      lifecycle: {
        ...(defaultBindingMeta.lifecycle as Record<string, unknown>),
        initializedAt: new Date(event.timestamp).toISOString(),
        initializedFromEventId: event.eventId,
        lastMaterializedBy: "command_new",
        previousSessionId: resolved.sessionId,
      },
    },
  });

  return session.id;
};

const handleStatusCommand: ChannelCommandHandler = async (input) => {
  const { event, resolved, command, deps } = input;
  await createInboundCommandRef({ deps, event, resolved, command });
  await dispatchCommandReply({
    deps,
    event,
    resolved,
    sessionId: resolved.sessionId,
    text: await getSessionStatusText(resolved.spaceId, resolved.sessionId),
  });
  return true;
};

const handleNewCommand: ChannelCommandHandler = async (input) => {
  const { event, resolved, command, deps } = input;
  const sessionId = await createFreshSessionForBinding(deps, event, resolved);
  await createInboundCommandRef({ deps, event, resolved, command, sessionId });
  await dispatchCommandReply({
    deps,
    event,
    resolved,
    sessionId,
    text: `Created a new session.\nCohub: ${getSessionUrl(resolved.spaceId, sessionId)}`,
  });
  return true;
};

const channelCommandHandlers: Record<GatewayChannelCommandName, ChannelCommandHandler> = {
  new: handleNewCommand,
  status: handleStatusCommand,
};

export const executeChannelCommand = async (input: ChannelCommandExecutionInput) => {
  const handler = channelCommandHandlers[input.command.name];
  return handler(input);
};
