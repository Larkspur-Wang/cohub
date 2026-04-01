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

const readResultEvents = async (input: {
  interactionId: string;
  signal?: AbortSignal;
  onEvent: (event: GatewaySessionResponseResultEvent) => Promise<boolean | undefined> | boolean | undefined;
}) => {
  const client = createBlockingRedisClient();
  await client.connect();
  const streamKey = getGatewaySessionResponseResultStreamKey(input.interactionId);
  let lastId = "$";
  const startedAt = Date.now();

  try {
    while (!input.signal?.aborted && Date.now() - startedAt < 10 * 60 * 1000) {
      const result = await client.xread("BLOCK", 1000, "STREAMS", streamKey, lastId);
      if (!result) continue;

      for (const [, entries] of result as Array<[string, Array<[string, string[]]>]>) {
        for (const [id, fields] of entries) {
          lastId = id;
          const payloadIndex = fields.indexOf("payload");
          const payloadRaw = payloadIndex >= 0 ? fields[payloadIndex + 1] : null;
          if (!payloadRaw) continue;

          const payload = JSON.parse(payloadRaw) as GatewaySessionResponseResultEvent;
          if (payload.interactionId !== input.interactionId) continue;

          const shouldStop = await input.onEvent(payload);
          if (shouldStop) {
            return;
          }
        }
      }
    }

    if (input.signal?.aborted) {
      throw new Error("request aborted");
    }

    throw new Error("Timed out waiting for session response result");
  } finally {
    await client.quit().catch(async () => {
      client.disconnect();
    });
  }
};

const waitForAcceptedResult = async (input: {
  interactionId: string;
  signal?: AbortSignal;
}): Promise<{ userMessageId: string }> => {
  let accepted: { userMessageId: string } | null = null;

  await readResultEvents({
    interactionId: input.interactionId,
    signal: input.signal,
    onEvent: async (payload) => {
      if (payload.type === "failed") {
        throw new Error(payload.error.message);
      }
      if (payload.type === "accepted") {
        accepted = { userMessageId: payload.userMessageId };
        return true;
      }
    },
  });

  if (!accepted) {
    throw new Error("Timed out waiting for session response acceptance");
  }

  return accepted;
};

const extractFinalAssistantText = (payload: Record<string, unknown>, fallbackText: string) => {
  const event = payload.event as Record<string, unknown> | undefined;
  const message = event?.message as Record<string, unknown> | undefined;
  if (!message || typeof message !== "object") {
    return fallbackText;
  }

  const content = Array.isArray(message.content) ? message.content : [];
  const text = content
    .filter((item): item is { type?: string; text?: string } => !!item && typeof item === "object")
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n")
    .trim();

  return text || fallbackText;
};

const createResponseEnvelope = (input: {
  request: CohubSessionResponseRequest;
  actorUserId: string;
  source: GatewaySessionResponseRequestEvent["actor"]["source"];
}) => {
  const responseId = `resp_${randomUUID().replace(/-/g, "")}`;

  return {
    interactionId: randomUUID(),
    responseId,
    itemId: `${responseId}_output_0`,
    createdAt: Math.floor(Date.now() / 1000),
    model: input.request.model ?? "cohub-agent",
    runtimeId: input.request.runtimeId,
    sessionId: input.request.sessionId,
    async publish() {
      await publishGatewaySessionResponseRequest({
        interactionId: this.interactionId,
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
    },
  };
};

export const streamSessionResponse = async function* (input: {
  actorUserId: string;
  source: GatewaySessionResponseRequestEvent["actor"]["source"];
  request: CohubSessionResponseRequest;
  signal?: AbortSignal;
}): AsyncGenerator<CohubSessionResponseEvent> {
  const envelope = createResponseEnvelope(input);
  await envelope.publish();

  const { userMessageId } = await waitForAcceptedResult({
    interactionId: envelope.interactionId,
    signal: input.signal,
  });

  yield {
    type: "response.created",
    response: {
      id: envelope.responseId,
      object: "response",
      created_at: envelope.createdAt,
      status: "in_progress",
      model: envelope.model,
    },
  } satisfies CohubSessionResponseEvent;

  const runtimeClient = createBlockingRedisClient();
  const resultClient = createBlockingRedisClient();
  await Promise.all([runtimeClient.connect(), resultClient.connect()]);

  const runtimeStreamKey = getRuntimeOutputStreamKey(input.request.runtimeId);
  const resultStreamKey = getGatewaySessionResponseResultStreamKey(envelope.interactionId);

  let runtimeLastId = "0";
  let resultLastId = "$";
  let assistantText = "";
  let completed = false;
  let aborted = false;
  const startedAt = Date.now();

  try {
    while (!input.signal?.aborted && Date.now() - startedAt < 10 * 60 * 1000) {
      const [runtimeResult, resultEvents] = await Promise.all([
        runtimeClient.xread("BLOCK", 1000, "STREAMS", runtimeStreamKey, runtimeLastId),
        resultClient.xread("BLOCK", 1000, "STREAMS", resultStreamKey, resultLastId),
      ]);

      if (resultEvents) {
        for (const [, entries] of resultEvents as Array<[string, Array<[string, string[]]>]>) {
          for (const [id, fields] of entries) {
            resultLastId = id;
            const payloadIndex = fields.indexOf("payload");
            const payloadRaw = payloadIndex >= 0 ? fields[payloadIndex + 1] : null;
            if (!payloadRaw) continue;

            const payload = JSON.parse(payloadRaw) as GatewaySessionResponseResultEvent;
            if (payload.interactionId !== envelope.interactionId) continue;

            if (payload.type === "failed") {
              throw new Error(payload.error.message);
            }
          }
        }
      }

      if (!runtimeResult) {
        continue;
      }

      for (const [, entries] of runtimeResult as Array<[string, Array<[string, string[]]>]>) {
        for (const [id, fields] of entries) {
          runtimeLastId = id;
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
            if (!answer) continue;

            const delta = answer.startsWith(assistantText) ? answer.slice(assistantText.length) : answer;
            assistantText = answer;

            if (delta) {
              yield {
                type: "response.output_text.delta",
                item_id: envelope.itemId,
                output_index: 0,
                content_index: 0,
                delta,
              } satisfies CohubSessionResponseEvent;
            }
          }

          if (payload?.type === "agent_event") {
            const event = payload.event as Record<string, unknown> | undefined;
            const eventType = typeof event?.type === "string" ? event.type : "";
            const message = event?.message as Record<string, unknown> | undefined;
            const meta = (message?.meta as Record<string, unknown> | null) ?? null;
            const anchorUserMessageId = typeof meta?.anchorUserMessageId === "string" ? meta.anchorUserMessageId : null;
            if (eventType !== "turn_end") continue;
            if (anchorUserMessageId && anchorUserMessageId !== userMessageId) continue;

            const finalText = extractFinalAssistantText(payload, assistantText);
            const trailingDelta = finalText.startsWith(assistantText) ? finalText.slice(assistantText.length) : "";
            assistantText = finalText;

            if (trailingDelta) {
              yield {
                type: "response.output_text.delta",
                item_id: envelope.itemId,
                output_index: 0,
                content_index: 0,
                delta: trailingDelta,
              } satisfies CohubSessionResponseEvent;
            }

            yield {
              type: "response.completed",
              response: {
                id: envelope.responseId,
                object: "response",
                created_at: envelope.createdAt,
                status: "completed",
                model: envelope.model,
                output: [buildOutputItem(envelope.responseId, assistantText)],
              },
            } satisfies CohubSessionResponseEvent;
            completed = true;
            return;
          }
        }
      }
    }

    aborted = Boolean(input.signal?.aborted);
    throw new Error(aborted ? "request aborted" : "Timed out waiting for response");
  } finally {
    await Promise.all([
      runtimeClient.quit().catch(async () => {
        runtimeClient.disconnect();
      }),
      resultClient.quit().catch(async () => {
        resultClient.disconnect();
      }),
    ]);
  }

  if (!completed && aborted) {
    throw new Error("request aborted");
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
  let responseId = "";
  let itemId = "";
  let model = input.request.model ?? "cohub-agent";
  let createdAt = Math.floor(Date.now() / 1000);
  let text = "";

  for await (const event of streamSessionResponse(input)) {
    if (event.type === "response.created") {
      responseId = event.response.id;
      model = event.response.model;
      createdAt = event.response.created_at;
      continue;
    }

    if (event.type === "response.output_text.delta") {
      itemId = event.item_id;
      text = `${text}${event.delta}`;
      continue;
    }

    if (event.type === "response.completed") {
      responseId = event.response.id;
      model = event.response.model;
      createdAt = event.response.created_at;
      itemId = event.response.output[0]?.id ?? itemId;
      text = event.response.output[0]?.content[0]?.text ?? text;
      break;
    }

    if (event.type === "response.failed") {
      throw new Error(event.response.error.message);
    }
  }

  if (!responseId) {
    throw new Error("Failed to create session response");
  }

  return {
    responseId,
    itemId: itemId || `${responseId}_output_0`,
    model,
    createdAt,
    text,
  };
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
