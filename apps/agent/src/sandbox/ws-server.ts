import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { Duplex } from "node:stream";
import type {
  AgentSandboxMessage,
  RpcMethod,
  RpcRequestMap,
  RpcStreamEvent,
} from "@cohub/agent-sandbox-protocol";
import { AGENT_SANDBOX_PROTOCOL_VERSION } from "@cohub/agent-sandbox-protocol";
import { env } from "../env.js";

type PendingRequest = {
  resolve: (value: never) => void;
  reject: (error: Error) => void;
  onStream?: (event: RpcStreamEvent) => void;
};

export class SandboxConnection {
  private readonly pending = new Map<string, PendingRequest>();

  constructor(
    readonly sandboxId: string,
    private readonly socket: Duplex,
  ) {}

  send(message: AgentSandboxMessage) {
    this.socket.write(encodeWebSocketFrame(JSON.stringify(message)));
  }

  request<M extends RpcMethod>(
    method: M,
    params: RpcRequestMap[M]["params"],
    options: {
      requestId?: string;
      spaceId: string;
      sandboxId: string;
      onStream?: (event: RpcStreamEvent) => void;
    },
  ): Promise<RpcRequestMap[M]["result"]> {
    const requestId = options.requestId ?? randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, {
        resolve,
        reject,
        onStream: options.onStream,
      });

      this.send({
        version: AGENT_SANDBOX_PROTOCOL_VERSION,
        type: "rpc.request",
        requestId,
        spaceId: options.spaceId,
        sandboxId: options.sandboxId,
        sessionId: null,
        toolCallId: null,
        timestamp: Date.now(),
        method,
        params,
      });
    });
  }

  handleMessage(message: AgentSandboxMessage) {
    if (message.type === "rpc.stream") {
      const pending = this.pending.get(message.requestId);
      pending?.onStream?.(message.event);
      if (message.event.type === "exit") {
        this.pending.delete(message.requestId);
      }
      return;
    }

    if (message.type === "rpc.response") {
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      this.pending.delete(message.requestId);
      pending.resolve(message.result as never);
      return;
    }

    if (message.type === "rpc.error") {
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      this.pending.delete(message.requestId);
      pending.reject(new Error(message.error.message));
      return;
    }
  }

  dispose(error?: Error) {
    for (const [requestId, pending] of this.pending) {
      pending.reject(error ?? new Error("sandbox connection closed"));
      this.pending.delete(requestId);
    }
  }
}

let activeConnection: SandboxConnection | null = null;
let resolveWaiters: Array<(connection: SandboxConnection) => void> = [];

function setActiveConnection(connection: SandboxConnection | null) {
  if (activeConnection && activeConnection !== connection) {
    activeConnection.dispose(new Error("sandbox connection replaced by a newer connection"));
  }
  activeConnection = connection;
  if (connection) {
    for (const resolve of resolveWaiters) resolve(connection);
    resolveWaiters = [];
  }
}

export async function waitForSandboxConnection(timeoutMs = 30000): Promise<SandboxConnection> {
  if (activeConnection) return activeConnection;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      resolveWaiters = resolveWaiters.filter((item) => item !== onResolve);
      reject(new Error(`Timed out waiting for sandbox connection after ${timeoutMs}ms`));
    }, timeoutMs);

    const onResolve = (connection: SandboxConnection) => {
      clearTimeout(timeout);
      resolve(connection);
    };

    resolveWaiters.push(onResolve);
  });
}

function encodeWebSocketFrame(payload: string): Buffer {
  const payloadBuffer = Buffer.from(payload, "utf8");
  const length = payloadBuffer.length;

  if (length < 126) {
    return Buffer.concat([Buffer.from([0x81, length]), payloadBuffer]);
  }

  if (length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, payloadBuffer]);
  }

  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, payloadBuffer]);
}

function decodeWebSocketFrames(
  socket: Duplex,
  buffer: Buffer,
): { messages: string[]; remaining: Uint8Array } {
  const messages: string[] = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    if (first === undefined || second === undefined) break;

    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let payloadLength = second & 0x7f;
    let headerLength = 2;

    if (payloadLength === 126) {
      if (offset + 4 > buffer.length) break;
      payloadLength = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (payloadLength === 127) {
      if (offset + 10 > buffer.length) break;
      payloadLength = Number(buffer.readBigUInt64BE(offset + 2));
      headerLength = 10;
    }

    const maskLength = masked ? 4 : 0;
    const frameLength = headerLength + maskLength + payloadLength;
    if (offset + frameLength > buffer.length) break;

    if (opcode === 0x8) {
      offset += frameLength;
      continue;
    }

    if (opcode === 0x9) {
      let payload = buffer.subarray(offset + headerLength + maskLength, offset + frameLength);
      if (masked) {
        const mask = buffer.subarray(offset + headerLength, offset + headerLength + 4);
        const unmasked = Buffer.alloc(payload.length);
        for (let i = 0; i < payload.length; i++) {
          unmasked[i] = (payload[i] ?? 0) ^ (mask[i % 4] ?? 0);
        }
        payload = unmasked;
      }
      const pongHeader = Buffer.from([0x8a, payload.length]);
      const pongFrame = Buffer.concat([pongHeader, payload]);
      socket.write(pongFrame);
      offset += frameLength;
      continue;
    }

    let payload = buffer.subarray(offset + headerLength + maskLength, offset + frameLength);
    if (masked) {
      const mask = buffer.subarray(offset + headerLength, offset + headerLength + 4);
      const unmasked = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i++) {
        unmasked[i] = (payload[i] ?? 0) ^ (mask[i % 4] ?? 0);
      }
      payload = unmasked;
    }

    if (opcode === 0x1) {
      messages.push(payload.toString("utf8"));
    }

    offset += frameLength;
  }

  return { messages, remaining: buffer.subarray(offset) };
}

function sha1Base64(input: string): string {
  return createHash("sha1").update(input).digest("base64");
}

export async function startSandboxWsServer() {
  const server = createServer((_req, res) => {
    res.statusCode = 404;
    res.end("Not found");
  });

  server.on("upgrade", (req, socket) => {
    if (req.url !== "/sandbox") {
      socket.destroy();
      return;
    }

    const key = req.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      socket.destroy();
      return;
    }

    const accept = sha1Base64(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`);
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "",
        "",
      ].join("\r\n"),
    );

    let connection: SandboxConnection | null = null;
    let buffered = Buffer.alloc(0);

    socket.on("data", (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      const decoded = decodeWebSocketFrames(socket, buffered);
      buffered = Buffer.from(decoded.remaining);

      for (const raw of decoded.messages) {
        try {
          const message = JSON.parse(raw) as AgentSandboxMessage;
          if (message.type === "sandbox.hello") {
            connection = new SandboxConnection(message.sandboxId, socket);
            setActiveConnection(connection);
            connection.send({
              version: AGENT_SANDBOX_PROTOCOL_VERSION,
              type: "sandbox.hello_ack",
              spaceId: env.SPACE_ID,
              sandboxId: message.sandboxId,
              timestamp: Date.now(),
              accepted: true,
            });
            continue;
          }
          connection?.handleMessage(message);
        } catch (error) {
          console.error("[SandboxWS] Failed to handle message:", error);
        }
      }
    });

    socket.on("close", () => {
      connection?.dispose();
      if (activeConnection === connection) setActiveConnection(null);
    });

    socket.on("error", (error) => {
      console.error("[SandboxWS] Socket error:", error);
      connection?.dispose(error instanceof Error ? error : new Error(String(error)));
      if (activeConnection === connection) setActiveConnection(null);
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(env.SANDBOX_WS_PORT, env.SANDBOX_WS_HOST, resolve);
  });

  console.log(
    `[SandboxWS] Listening on ws://${env.SANDBOX_WS_HOST}:${env.SANDBOX_WS_PORT}/sandbox`,
  );
}
