import type { WebsocketClient } from "./websocket.js";

export function ensureRealtimeConnected(websocketClient: WebsocketClient) {
  void websocketClient.connect().catch((error) => {
    console.error("[CohubClient] Failed to connect realtime websocket:", error);
  });
}
