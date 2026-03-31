import type { OpenAIResponsesCreateRequest } from "@cohub/protocol";
import { randomUUID } from "node:crypto";
import {
  createBlockingRedisClient,
  getGatewaySessionResponseResultStreamKey,
  getRuntimeOutputStreamKey,
  publishGatewaySessionResponseRequest,
} from "../redis.js";
import type {
  CohubSessionResponseEvent,
  CohubSessionResponseRequest,
  GatewaySessionResponseRequestEvent,
  GatewaySessionResponseResultEvent,
  OpenAIResponseInputMessage,
} from "@cohub/protocol";

const extractTextFromInputMessage = (message: OpenAIResponseInputMessage): string => {
  if (typeof message.content === "string") return message.content.trim();
  return message.content
    .filter((item) => item.type === "input_text")
    .map((item) => item.text)
    .join("\n")
    .trim();
};

export const normalizeSessionResponseRequest = (input: {
  runtimeId: string;
  sessionId: string;
  body: OpenAIResponsesCreateRequest;
}): CohubSessionResponseRequest => {
  const model = input.body.model?.trim() || "cohub-agent";
  let inputText = "";

  if (typeof input.body.input === "string") {
    inputText = input.body.input.trim();
  } else if (Array.isArray(input.body.input)) {
    const userMessages = input.body.input.filter((item) => item.role === "user");
    const latest = userMessages.at(-1) ?? input.body.input.at(-1);
    inputText = latest ? extractTextFromInputMessage(latest) : "";
  }

  return {
    runtimeId: input.runtimeId,
    sessionId: input.sessionId,
    model,
    inputText,
    stream: Boolean(input.body.stream),
    metadata: input.body.metadata ?? null,
  };
};

const buildOutputItem = (responseId: string, text: string) => ({
  id: `${responseId}_output_0`,
  type: "message" as const,
  role: "assistant" as const,
  content: [
    {
      type: "output_text" as const,
      text,
      annotations: [] as [],
    },
  ],
});

const waitForAcceptedResult = async (input: {
  interactionId: string;
  signal?: AbortSignal;
}): Promise<{ userMessageId: string }> => {
  const client = createBlockingRedisClient();
  await client.connect();
  const streamKey = getGatewaySessionResponseResultStreamKey(input.interactionId);
  let lastId = "$";
  const startedAt = Date.now();

  try {
    while (!input.signal?.aborted && Date.now() - startedAt < 60_000) {
      const result = await client.xread("BLOCK", 15000, "STREAMS", streamKey, lastId);
      if (!result) continue;

      for (const [, entries] of result as Array<[string, Array<[string, string[]]>]>) {
        for (const [id, fields] of entries) {
          lastId = id;
          const payloadIndex = fields.indexOf("payload");
          const payloadRaw = payloadIndex >= 0 ? fields[payloadIndex + 1] : null;
          if (!payloadRaw) continue;

          const payload = JSON.parse(payloadRaw) as GatewaySessionResponseResultEvent;
          if (payload.interactionId !== input.interactionId) continue;
          if (payload.type === "failed") {
            throw new Error(payload.error.message);
          }
          if (payload.type === "accepted") {
            return { userMessageId: payload.userMessageId };
          }
        }
      }
    }

    throw new Error(input.signal?.aborted ? "request aborted" : "Timed out waiting for session response acceptance");
  } finally {
    await client.quit().catch(async () => {
      client.disconnect();
    });
  }
};

const waitForLifecycleResult = async (input: {
  interactionId: string;
  expectedType: "started" | "completed";
  signal?: AbortSignal;
}) => {
  const client = createBlockingRedisClient();
  await client.connect();
  const streamKey = getGatewaySessionResponseResultStreamKey(input.interactionId);
  let lastId = "$";
  const startedAt = Date.now();

  try {
    while (!input.signal?.aborted && Date.now() - startedAt < 10 * 60 * 1000) {
      const result = await client.xread("BLOCK", 15000, "STREAMS", streamKey, lastId);
      if (!result) continue;

      for (const [, entries] of result as Array<[string, Array<[string, string[]]>]>) {
        for (const [id, fields] of entries) {
          lastId = id;
          const payloadIndex = fields.indexOf("payload");
          const payloadRaw = payloadIndex >= 0 ? fields[payloadIndex + 1] : null;
          if (!payloadRaw) continue;

          const payload = JSON.parse(payloadRaw) as GatewaySessionResponseResultEvent;
          if (payload.interactionId !== input.interactionId) continue;
          if (payload.type === "failed") {
            throw new Error(payload.error.message);
          }
          if (payload.type === input.expectedType) {
            return payload;
          }
        }
      }
    }

    throw new Error(input.signal?.aborted ? "request aborted" : `Timed out waiting for interaction ${input.expectedType}`);
  } finally {
    await client.quit().catch(async () => {
      client.disconnect();
    });
  }
};

export const createSessionResponse = async (input: {
  token: string;
  actorUserId: string;
  source: GatewaySessionResponseRequestEvent["actor"]["source"];
  request: CohubSessionResponseRequest;
  signal?: AbortSignal;
}): Promise<{
  responseId: string;
  itemId: string;
  model: string;
  createdAt: number;
  text: string;
}> => {
  const responseId = `resp_${randomUUID().replace(/-/g, "")}`;
  const itemId = `${responseId}_output_0`;
  const createdAt = Math.floor(Date.now() / 1000);
  const interactionId = randomUUID();

  await publishGatewaySessionResponseRequest({
    interactionId,
    timestamp: Date.now(),
    runtimeId: input.request.runtimeId,
    sessionId: input.request.sessionId,
    inputText: input.request.inputText,
    model: input.request.model ?? null,
    metadata: input.request.metadata ?? null,
    actor: {
      userId: input.actorUserId,
      source: input.source,
    },
  });

  const { userMessageId } = await waitForAcceptedResult({
    interactionId,
    signal: input.signal,
  });

  void waitForLifecycleResult({
    interactionId,
    expectedType: "started",
    signal: input.signal,
  }).catch(() => undefined);

  const streamKey = getRuntimeOutputStreamKey(input.request.runtimeId);
  const client = createBlockingRedisClient();
  await client.connect();

  let lastId = "$";
  let finalText = "";
  let lastAssistantText = "";
  const startedAt = Date.now();

  try {
    await waitForLifecycleResult({
      interactionId,
      expectedType: "completed",
      signal: input.signal,
    }).catch(() => undefined);

    while (!input.signal?.aborted && Date.now() - startedAt < 10 * 60 * 1000) {
      const result = await client.xread("BLOCK", 15000, "STREAMS", streamKey, lastId);
      if (!result) continue;

      for (const [, entries] of result as Array<[string, Array<[string, string[]]>]>) {
        for (const [id, fields] of entries) {
          lastId = id;
          const payloadIndex = fields.indexOf("payload");
          const payloadRaw = payloadIndex >= 0 ? fields[payloadIndex + 1] : null;
          if (!payloadRaw) continue;

          let payload: Record<string, unknown> | null = null;
          try {
            payload = JSON.parse(payloadRaw) as Record<string, unknown>;
          } catch {
            continue;
          }

          if (payload?.runtimeId !== input.request.runtimeId) continue;
          if (payload?.sessionId !== input.request.sessionId) continue;

          if (payload?.type === "provider_render_update" && payload?.sourceMessageId === userMessageId) {
            const answer = typeof payload.answer === "string" ? payload.answer : "";
            lastAssistantText = answer;
          }

          if (payload?.type === "agent_event") {
            const event = payload.event as Record<string, unknown> | undefined;
            const message = event?.message as Record<string, unknown> | undefined;
            const eventType = typeof event?.type === "string" ? event.type : "";
            if (eventType !== "turn_end") continue;
            if (!message || typeof message !== "object") continue;
            const content = Array.isArray(message.content) ? message.content : [];
            const text = content
              .filter((item): item is { type?: string; text?: string } => !!item && typeof item === "object")
              .filter((item) => item.type === "text" && typeof item.text === "string")
              .map((item) => item.text)
              .join("\n")
              .trim();

            finalText = text || lastAssistantText;
            return {
              responseId,
              itemId,
              model: input.request.model ?? "cohub-agent",
              createdAt,
              text: finalText,
            };
          }
        }
      }
    }

    throw new Error(input.signal?.aborted ? "request aborted" : "Timed out waiting for response");
  } finally {
    await client.quit().catch(async () => {
      client.disconnect();
    });
  }
};

export const buildResponseObject = (input: {
  responseId: string;
  model: string;
  createdAt: number;
  text: string;
}) => ({
  id: input.responseId,
  object: "response",
  created_at: input.createdAt,
  status: "completed",
  model: input.model,
  output: [buildOutputItem(input.responseId, input.text)],
});

export const buildStreamEvents = (input: {
  responseId: string;
  itemId: string;
  model: string;
  createdAt: number;
  text: string;
}): CohubSessionResponseEvent[] => {
  const createdEvent: CohubSessionResponseEvent = {
    type: "response.created",
    response: {
      id: input.responseId,
      object: "response",
      created_at: input.createdAt,
      status: "in_progress",
      model: input.model,
    },
  };

  const deltas = input.text
    ? [{
        type: "response.output_text.delta",
        item_id: input.itemId,
        output_index: 0,
        content_index: 0,
        delta: input.text,
      } satisfies CohubSessionResponseEvent]
    : [];

  const completed: CohubSessionResponseEvent = {
    type: "response.completed",
    response: {
      id: input.responseId,
      object: "response",
      created_at: input.createdAt,
      status: "completed",
      model: input.model,
      output: [buildOutputItem(input.responseId, input.text)],
    },
  };

  return [createdEvent, ...deltas, completed];
};
