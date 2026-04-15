import type { ContentBlock, PersistMessageInput, RegisterSessionInput } from "@cohub/protocol";
import { config } from "./config.js";

/**
 * Custom error that carries HTTP status code for callers to inspect.
 */
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

/**
 * Send a message to a session via the internal API.
 * Reuses the same logic as user-facing message sending (enqueue + dispatch).
 */
export const sendSessionMessage = async (
  runtimeId: string,
  sessionId: string,
  message: PersistMessageInput["message"],
) => {
  return internalFetch(
    `/internal/runtimes/${runtimeId}/sessions/${sessionId}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: `worker-${crypto.randomUUID()}`,
        message,
      }),
    },
  );
};

/**
 * Register a new session for a cronjob execution.
 * Sets source to identify the origin for sidebar display.
 */
export const registerCronjobSession = async (
  runtimeId: string,
  options: {
    source: string;
    title?: string | null;
  },
) => {
  const sessionId = crypto.randomUUID();
  const input: RegisterSessionInput = {
    runtimeId,
    sessionId,
    title: options.title ?? null,
    source: options.source,
    protocol: "pi",
    externalSessionId: null,
    cwd: null,
    meta: { createdBy: "cronjob" },
  };
  const result = await internalFetch(
    `/internal/runtimes/${runtimeId}/sessions`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return result.session;
};

/**
 * Enqueue a user prompt into a session's input queue.
 * Reuses the same pipeline as frontend message sending — full multimodal support.
 */
export const enqueuePrompt = async (
  runtimeId: string,
  sessionId: string,
  options: {
    content: ContentBlock[];
    userMessageId?: string;
    meta?: Record<string, unknown> | null;
  },
) => {
  return internalFetch(
    `/internal/runtimes/${runtimeId}/sessions/${sessionId}/prompt`,
    {
      method: "POST",
      body: JSON.stringify({
        content: options.content,
        userMessageId: options.userMessageId,
        meta: options.meta,
      }),
    },
  );
};
