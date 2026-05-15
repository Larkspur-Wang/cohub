import type { SpaceFsChangedPayload } from "@cohub/protocol/fs";
import { config } from "./config.js";

export async function publishSpaceFsChanged(spaceId: string, payload: SpaceFsChangedPayload) {
  try {
    const response = await fetch(`${config.internalApiBaseUrl}/internal/space-events/${spaceId}/fs-changed`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-worker-secret": config.workerSecret,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Failed to report fs changes ${response.status}: ${text}`);
    }
  } catch (error) {
    console.warn(`[SpaceEvents] Failed to publish space fs changed for ${spaceId}:`, error);
    throw error;
  }
}
