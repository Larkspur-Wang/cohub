import { randomUUID } from "node:crypto";
import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import type { GatewayInboundEvent } from "@neta-art/cohub-protocol/gateway";
import { enqueueSpacePrompt } from "./space-sessions.js";
import { createProviderMessageRef } from "./channels.js";
import { createSessionTurn, failSessionTurn } from "./session-turns.js";

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
  model?: string;
  provider?: string;
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
  const turnId = randomUUID();
  const promptMeta = {
    ...(input.inboundRef?.meta ?? {}),
    source: input.source,
    interactionId: input.interactionId,
    actorUserId: input.actorUserId ?? null,
    model: input.model ?? null,
    provider: input.provider ?? null,
    turnId,
  };

  await createSessionTurn({
    id: turnId,
    sessionId: input.sessionId,
    userUuid: input.actorUserId ?? null,
    userContent: input.content,
    intent: "steer",
    meta: promptMeta,
  });

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
        turnId,
      },
    });
  }

  try {
    await enqueueSpacePrompt({
      spaceId: input.spaceId,
      sessionId: input.sessionId,
      userMessageId,
      content: input.content,
      meta: promptMeta,
    });
  } catch (error) {
    await failSessionTurn({
      sessionId: input.sessionId,
      turnId,
      errorMessage: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
    throw error;
  }

  return { userMessageId, turnId };
};
