import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import type { PersistMessageInput, RegisterSessionInput } from "@neta-art/cohub-protocol/model";
import { config } from "./config.js";

export class InternalApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = "InternalApiError";
  }
}

const internalFetch = async (path: string, options: RequestInit = {}) => {
  const url = `${config.internalApiBaseUrl}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-worker-secret": config.workerSecret,
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new InternalApiError(
      `Internal API ${res.status} ${res.statusText}: ${body}`,
      res.status,
    );
  }
  return res.json();
};

export const sendSessionMessage = async (
  spaceId: string,
  sessionId: string,
  message: PersistMessageInput["message"],
) => {
  return internalFetch(
    `/internal/spaces/${spaceId}/sessions/${sessionId}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: `worker-${crypto.randomUUID()}`,
        message,
      }),
    },
  );
};

export const registerCronjobSession = async (
  spaceId: string,
  options: {
    source: string;
    title?: string | null;
  },
) => {
  const sessionId = crypto.randomUUID();
  const input: RegisterSessionInput = {
    spaceId,
    sessionId,
    title: options.title ?? null,
    source: options.source,
    externalSessionId: null,
    meta: { createdBy: "cronjob" },
  };
  const result = await internalFetch(
    `/internal/spaces/${spaceId}/sessions`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return result.session;
};

export const enqueuePrompt = async (
  spaceId: string,
  sessionId: string,
  options: {
    content: ContentBlock[];
    userId: string;
    clientMessageId: string;
    source: string;
    model?: string | null;
    provider?: string | null;
    context?: Record<string, unknown> | null;
  },
) => {
  return internalFetch(
    `/internal/spaces/${spaceId}/sessions/${sessionId}/prompt`,
    {
      method: "POST",
      body: JSON.stringify({
        content: options.content,
        userId: options.userId,
        clientMessageId: options.clientMessageId,
        source: options.source,
        model: options.model,
        provider: options.provider,
        context: options.context,
      }),
    },
  );
};
