import { randomUUID } from "node:crypto";
import type { ContentBlock, GatewayInboundEvent } from "@cohub/protocol";
import { enqueueRuntimePrompt, forkRuntimeSession, registerRuntimeSession } from "./runtime-sessions.js";
import {
  createRuntimeSessionBinding,
  getBindingByRuntimeChannelAndKey,
  getProviderMessageRef,
  resolveForkSourceForInboundEvent,
  touchRuntimeSessionBinding,
  updateRuntimeSessionBindingMeta,
  buildDefaultBindingMeta,
  createProviderMessageRef,
} from "./channels.js";
import { buildSessionSourceChannel } from "@cohub/protocol";
import { providerMessageRefs, runtimeChannels } from "./db/schema.js";
import { db } from "./db/index.js";
import { eq } from "drizzle-orm";

export const executeSessionInteraction = async (input: {
  runtimeId: string;
  sessionId: string;
  inputText: string;
  content: ContentBlock[];
  source: string;
  interactionId: string;
  actorUserId?: string | null;
  inboundRef?: {
    provider: string;
    runtimeChannelId: string;
    externalConversationId: string;
    externalMessageId: string;
    externalAuthorId?: string | null;
    externalAuthorName?: string | null;
    meta?: Record<string, unknown> | null;
  } | null;
}) => {
  // Generate UUID for user message — actual persistence happens on agent's message_end event
  // to guarantee correct sequence ordering
  const userMessageId = randomUUID();

  // Record inbound reference for provider routing (Discord reply/edit)
  if (input.inboundRef) {
    await createProviderMessageRef({
      provider: input.inboundRef.provider,
      runtimeId: input.runtimeId,
      runtimeSessionId: input.sessionId,
      runtimeChannelId: input.inboundRef.runtimeChannelId,
      sessionMessageId: userMessageId,
      direction: "inbound",
      externalConversationId: input.inboundRef.externalConversationId,
      externalMessageId: input.inboundRef.externalMessageId,
      externalAuthorId: input.inboundRef.externalAuthorId ?? null,
      externalAuthorName: input.inboundRef.externalAuthorName ?? null,
      meta: {
        ...(input.inboundRef.meta ?? {}),
        interactionId: input.interactionId,
        messageKind: "user",
        anchorUserMessageId: userMessageId,
      },
    });
  }

  await enqueueRuntimePrompt({
    runtimeId: input.runtimeId,
    sessionId: input.sessionId,
    userMessageId,
    content: input.content,
    meta: {
      source: input.source,
      interactionId: input.interactionId,
      actorUserId: input.actorUserId ?? null,
      model: (input as { model?: string; provider?: string }).model ?? null,
      provider: (input as { model?: string; provider?: string }).provider ?? null,
    },
  });

  return { userMessageId };
};

export const resolveSessionInteractionForInboundEvent = async (event: GatewayInboundEvent) => {
  const [rc] = await db
    .select()
    .from(runtimeChannels)
    .where(eq(runtimeChannels.id, event.channelId))
    .limit(1);

  if (!rc) {
    console.warn(`[Channels] Received inbound event for unknown runtime-channel: ${event.channelId}`);
    return null;
  }

  const conversationId = event.conversation?.id?.trim() || event.externalChatId;
  const existingInboundRef = await getProviderMessageRef({
    provider: event.provider,
    externalConversationId: conversationId,
    externalMessageId: event.externalMessageId,
    direction: "inbound",
  });

  if (existingInboundRef) {
    console.log(
      `[Channels] Duplicate inbound ignored provider=${event.provider} conversation=${conversationId} message=${event.externalMessageId}`,
    );
    return null;
  }

  const bindingKey = event.bindingKey?.trim() || `${event.provider}:conversation:${conversationId}`;

  let binding = await getBindingByRuntimeChannelAndKey({
    runtimeChannelId: rc.id,
    bindingKey,
  });

  if (!binding?.runtimeSessionId) {
    const forkSource = await resolveForkSourceForInboundEvent({
      runtimeId: rc.runtimeId,
      runtimeChannelId: rc.id,
      provider: event.provider,
      conversationId: event.conversation?.id?.trim() || event.externalChatId,
      parentConversationId: event.conversation?.parentId ?? null,
      parentMessageId: event.message?.parentMessageId ?? null,
    });

    const sessionSource = buildSessionSourceChannel(event);

    const session = forkSource
      ? await forkRuntimeSession({
          runtimeId: rc.runtimeId,
          parentSessionId: forkSource.parentSessionId,
          fromMessageId: forkSource.fromMessageId,
          newSessionId: randomUUID(),
        })
      : await registerRuntimeSession({
          runtimeId: rc.runtimeId,
          sessionId: randomUUID(),
          source: sessionSource,
          protocol: "pi",
          cwd: null,
          externalSessionId: null,
          meta: {
            source: `channel:${event.provider}`,
            createdFrom: event.eventType === "conversation_create" ? "gateway_conversation_create" : "gateway_inbound",
            conversation: event.conversation ?? null,
            providerMeta: event.meta ?? null,
          },
        });

    const bindingMeta = buildDefaultBindingMeta(event);
    binding = await createRuntimeSessionBinding({
      runtimeId: rc.runtimeId,
      runtimeSessionId: session.id,
      runtimeChannelId: rc.id,
      provider: event.provider,
      bindingKey,
      externalChatId: event.externalChatId,
      meta: {
        ...bindingMeta,
        lifecycle: {
          ...(bindingMeta.lifecycle as Record<string, unknown>),
          initializedAt: new Date(event.timestamp).toISOString(),
          initializedFromEventId: event.eventId,
          lastMaterializedBy: event.eventType === "conversation_create" ? "conversation_create" : "message_create",
        },
      },
    });
  } else {
    const existingLifecycle = (binding.meta as Record<string, unknown> | null)?.lifecycle as Record<string, unknown> | null;
    const lifecycleUpdate = {
      lifecycle: {
        sourceEventType: event.eventType ?? "message_create",
        precreated: existingLifecycle?.precreated === true || event.eventType === "conversation_create",
        createdVia:
          (typeof existingLifecycle?.createdVia === "string" ? existingLifecycle.createdVia : undefined) ??
          (event.eventType === "conversation_create" ? "conversation_create" : "message_create"),
        lastEventAt: new Date(event.timestamp).toISOString(),
        lastEventId: event.eventId,
        lastMaterializedBy:
          event.eventType === "conversation_create"
            ? "conversation_create"
            : (typeof existingLifecycle?.lastMaterializedBy === "string" ? existingLifecycle.lastMaterializedBy : "message_create"),
      },
    };
    await updateRuntimeSessionBindingMeta({ bindingId: binding.id, meta: lifecycleUpdate }).catch(console.error);
    await touchRuntimeSessionBinding(binding.id);
  }

  return {
    runtimeId: rc.runtimeId,
    runtimeChannelId: rc.id,
    sessionId: binding.runtimeSessionId,
    binding,
    conversationId,
    bindingKey,
  };
};
