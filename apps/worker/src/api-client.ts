import type { PersistMessageInput } from "@cohub/protocol";
import { config } from "./config.js";

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
    throw new Error(`Internal API ${res.status} ${res.statusText}: ${body}`);
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
