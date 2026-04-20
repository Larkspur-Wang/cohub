import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { ContentBlock, GatewayInboundEvent } from "@cohub/protocol";
import { buildSessionSourceChannel } from "@cohub/protocol";
import { db } from "./db/index.js";
import { spaceChannels } from "./db/schema-v2.js";
import { enqueueSpacePrompt, forkSpaceSession, registerSpaceSession } from "./space-sessions.js";
import {
  buildDefaultBindingMeta,
  createProviderMessageRef,
  createSpaceSessionBinding,
  getBindingBySpaceChannelAndKey,
  getProviderMessageRef,
  resolveForkSourceForInboundEvent,
  touchSpaceSessionBinding,
  updateSpaceSessionBindingMeta,
} from "./channels.js";

export type SessionInteractionInboundRef = {
  provider: string;
  spaceChannelId: string;
  externalConversationId: string;
  externalMessageId: string;
  externalAuthorId?: string | null;
  externalAuthorName?: string | null;
  meta?: Record<string, unknown> | null;
};

export type ResolvedInboundInteraction = {
  spaceId: string;
  sessionId: string;
  inputText: string;
  content: ContentBlock[];
  source: string;
  interactionId: string;
  actorUserId?: string | null;
  inboundRef?: SessionInteractionInboundRef | null;
};

export const extractInboundText = (event: GatewayInboundEvent) => {
  const textBlock = event.content.find(
    (block): block is { type: "text"; text: string } => block.type === "text",
  );
  return textBlock?.text || "";
};

export const executeSessionInteraction = async (input: ResolvedInboundInteraction) => {
  const userMessageId = randomUUID();

  if (input.inboundRef) {
    await createProviderMessageRef({
      provider: input.inboundRef.provider,
      spaceId: input.spaceId,
      spaceSessionId: input.sessionId,
      spaceChannelId: input.inboundRef.spaceChannelId,
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

  await enqueueSpacePrompt({
    spaceId: input.spaceId,
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
  const [spaceChannel] = await db.select().from(spaceChannels).where(eq(spaceChannels.id, event.channelId)).limit(1);
  if (!spaceChannel) return null;

  const conversationId = event.conversation?.id?.trim() || event.externalChatId;
  const existingInboundRef = await getProviderMessageRef({
    provider: event.provider,
    externalConversationId: conversationId,
    externalMessageId: event.externalMessageId,
    direction: "inbound",
  });
  if (existingInboundRef) return null;

  const bindingKey = event.bindingKey?.trim() || `${event.provider}:conversation:${conversationId}`;
  let binding = await getBindingBySpaceChannelAndKey({ spaceChannelId: spaceChannel.id, bindingKey });

  if (!binding?.spaceSessionId) {
    const forkSource = await resolveForkSourceForInboundEvent({
      spaceChannelId: spaceChannel.id,
      provider: event.provider,
      conversationId,
      parentConversationId: event.conversation?.parentId ?? null,
      parentMessageId: event.message?.parentMessageId ?? null,
    });

    const sessionSource = buildSessionSourceChannel(event);
    const session = forkSource
      ? await forkSpaceSession({
          spaceId: spaceChannel.spaceId,
          parentSessionId: forkSource.parentSessionId,
          fromMessageId: forkSource.fromMessageId,
          newSessionId: randomUUID(),
        })
      : await registerSpaceSession({
          spaceId: spaceChannel.spaceId,
          sessionId: randomUUID(),
          source: sessionSource,
          externalSessionId: null,
          meta: {
            source: `channel:${event.provider}`,
            createdFrom: event.eventType === "conversation_create" ? "gateway_conversation_create" : "gateway_inbound",
            conversation: event.conversation ?? null,
            providerMeta: event.meta ?? null,
          },
        });

    binding = await createSpaceSessionBinding({
      spaceId: spaceChannel.spaceId,
      spaceSessionId: session.id,
      spaceChannelId: spaceChannel.id,
      provider: event.provider,
      bindingKey,
      externalChatId: event.externalChatId,
      meta: {
        ...buildDefaultBindingMeta(event),
        lifecycle: {
          ...(buildDefaultBindingMeta(event).lifecycle as Record<string, unknown>),
          initializedAt: new Date(event.timestamp).toISOString(),
          initializedFromEventId: event.eventId,
          lastMaterializedBy: event.eventType === "conversation_create" ? "conversation_create" : "message_create",
        },
      },
    });
  } else {
    const existingLifecycle = (binding.meta as Record<string, unknown> | null)?.lifecycle as Record<string, unknown> | null;
    await updateSpaceSessionBindingMeta({
      bindingId: binding.id,
      meta: {
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
      },
    }).catch(console.error);
    await touchSpaceSessionBinding(binding.id);
  }

  return {
    spaceId: spaceChannel.spaceId,
    spaceChannelId: spaceChannel.id,
    sessionId: binding.spaceSessionId,
    binding,
    conversationId,
    bindingKey,
  };
};
