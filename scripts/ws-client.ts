import process from "node:process";
import WebSocket from "ws";

const gatewayUrl = process.env.GATEWAY_WS_URL ?? "ws://localhost:8788/ws";
const token = process.env.COHUB_TOKEN ?? "";
const spaceId = process.env.COHUB_SPACE_ID ?? "";
const sessionId = process.env.COHUB_SESSION_ID ?? "";
const text = process.env.COHUB_TEXT ?? "hello from ws client";

if (!token) {
  console.error("COHUB_TOKEN is required");
  process.exit(1);
}

const ws = new WebSocket(gatewayUrl);

ws.on("open", () => {
  console.log("[ws-client] connected");
  ws.send(JSON.stringify({
    type: "auth",
    requestId: `auth-${Date.now()}`,
    payload: { token },
  }));
});

ws.on("message", (data) => {
  const textData = typeof data === "string" ? data : data.toString("utf-8");
  console.log("[ws-client] <=", textData);
  try {
    const parsed = JSON.parse(textData) as { type?: string };
    if (parsed.type === "auth.ok" && spaceId && sessionId) {
      ws.send(JSON.stringify({
        type: "message.create",
        requestId: `msg-${Date.now()}`,
        payload: {
          spaceId,
          sessionId,
          text,
          clientMessageId: `client-${Date.now()}`,
        },
      }));
    }
  } catch {}
});

ws.on("close", (code, reason) => {
  console.log("[ws-client] closed", code, reason.toString());
});

ws.on("error", (error) => {
  console.error("[ws-client] error", error);
});

setInterval(() => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "ping", requestId: `ping-${Date.now()}` }));
  }
}, 20_000);
