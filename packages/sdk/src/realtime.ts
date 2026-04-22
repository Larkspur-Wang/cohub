import type { getWebsocketClient } from "./websocket.js";

export function ensureRealtimeConnected(
  websocketClient: ReturnType<typeof getWebsocketClient>,
) {
  void websocketClient.connect().catch((error) => {
    console.error("[CohubClient] Failed to connect realtime websocket:", error);
  });
}
