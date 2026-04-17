import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { Duplex } from "node:stream";
import {
  AGENT_SANDBOX_PROTOCOL_VERSION,
  type AgentSandboxMessage,
  type RpcError,
  type RpcRequest,
  type RpcResponse,
  type RpcStream,
  type SandboxHeartbeat,
  type SandboxHello,
} from "@cohub/agent-sandbox-protocol";

const PORT = Number(process.env.SANDBOX_WS_PORT || 8788);
const HOST = process.env.SANDBOX_WS_HOST || "0.0.0.0";
const SPACE_ID = process.env.SANDBOX_WS_SPACE_ID || "00000000-0000-0000-0000-000000000001";
const SANDBOX_ID = process.env.SANDBOX_WS_SANDBOX_ID || "sandbox-dev";

type ConnectionState = {
  buffered: Buffer;
  sentPrepare: boolean;
  sentWrite: boolean;
  sentRead: boolean;
  sentProcess: boolean;
  processId: string | null;
};

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

function decodeWebSocketFrames(buffer: Buffer): { messages: string[]; remaining: Buffer } {
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

function send(socket: Duplex, message: AgentSandboxMessage) {
  socket.write(encodeWebSocketFrame(JSON.stringify(message)));
}

function makeRequest<M extends RpcRequest["method"]>(
  method: M,
  params: import("@cohub/agent-sandbox-protocol").RpcRequestMap[M]["params"],
): RpcRequest<M> {
  return {
    version: AGENT_SANDBOX_PROTOCOL_VERSION,
    type: "rpc.request",
    requestId: randomUUID(),
    spaceId: SPACE_ID,
    sandboxId: SANDBOX_ID,
    sessionId: null,
    toolCallId: null,
    timestamp: Date.now(),
    method,
    params,
  };
}

function sha1Base64(input: string): string {
  return createHash("sha1").update(input).digest("base64");
}

function maybeSendNext(socket: Duplex, state: ConnectionState, message: AgentSandboxMessage) {
  if (message.type === "sandbox.hello") {
    const helloAck: AgentSandboxMessage = {
      version: AGENT_SANDBOX_PROTOCOL_VERSION,
      type: "sandbox.hello_ack",
      spaceId: SPACE_ID,
      sandboxId: SANDBOX_ID,
      timestamp: Date.now(),
      accepted: true,
    };
    send(socket, helloAck);

    if (!state.sentPrepare) {
      state.sentPrepare = true;
      send(socket, makeRequest("workspace.prepare", {}));
    }
    return;
  }

  if (message.type !== "rpc.response") return;

  if (!state.sentWrite) {
    state.sentWrite = true;
    send(
      socket,
      makeRequest("fs.write", {
        path: "sandbox-dev.txt",
        content: "hello from sandbox dev server\nsecond line\n",
      }),
    );
    return;
  }

  if (!state.sentRead) {
    state.sentRead = true;
    send(socket, makeRequest("fs.read", { path: "sandbox-dev.txt", offset: 1, limit: 20 }));
    return;
  }

  if (!state.sentProcess) {
    state.sentProcess = true;
    send(
      socket,
      makeRequest("process.start", {
        command: "printf 'stdout line\\n'; printf 'stderr line\\n' >&2",
        timeoutSecs: 10,
      }),
    );
  }
}

function logMessage(message: AgentSandboxMessage) {
  if (message.type === "sandbox.hello") {
    const typed = message as SandboxHello;
    console.log("[sandbox-ws] <= hello", typed);
    return;
  }

  if (message.type === "sandbox.heartbeat") {
    const typed = message as SandboxHeartbeat;
    console.log("[sandbox-ws] <= heartbeat", typed.status, typed.timestamp);
    return;
  }

  if (message.type === "rpc.stream") {
    const typed = message as RpcStream;
    console.log("[sandbox-ws] <= stream", typed.event);
    return;
  }

  if (message.type === "rpc.response") {
    const typed = message as RpcResponse;
    console.log("[sandbox-ws] <= response", typed.result);
    return;
  }

  if (message.type === "rpc.error") {
    const typed = message as RpcError;
    console.error("[sandbox-ws] <= error", typed.error);
    return;
  }

  console.log("[sandbox-ws] <= message", message);
}

const server = createServer((req, res) => {
  if (req.url !== "/sandbox") {
    res.statusCode = 404;
    res.end("Not found");
    return;
  }

  const upgrade = req.headers.upgrade;
  if (!upgrade || upgrade.toLowerCase() !== "websocket") {
    res.statusCode = 426;
    res.end("Upgrade Required");
    return;
  }

  res.statusCode = 400;
  res.end("Use WebSocket upgrade");
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

  console.log("[sandbox-ws] client connected");
  const state: ConnectionState = {
    buffered: Buffer.alloc(0),
    sentPrepare: false,
    sentWrite: false,
    sentRead: false,
    sentProcess: false,
    processId: null,
  };

  socket.on("data", (chunk) => {
    state.buffered = Buffer.concat([state.buffered, chunk]);
    const decoded = decodeWebSocketFrames(state.buffered);
    state.buffered = decoded.remaining;

    for (const raw of decoded.messages) {
      try {
        const parsed = JSON.parse(raw) as AgentSandboxMessage;
        logMessage(parsed);

        if (parsed.type === "rpc.stream" && parsed.event.type === "started") {
          state.processId = parsed.event.processId;
        }

        maybeSendNext(socket, state, parsed);

        if (parsed.type === "rpc.response" && state.processId) {
          console.log("[sandbox-ws] process complete, last processId=", state.processId);
        }
      } catch (error) {
        console.error("[sandbox-ws] failed to parse message", error);
      }
    }
  });

  socket.on("close", () => {
    console.log("[sandbox-ws] client disconnected");
  });

  socket.on("error", (error) => {
    console.error("[sandbox-ws] socket error", error);
  });
});


server.listen(PORT, HOST, () => {
  console.log(`[sandbox-ws] listening on ws://${HOST}:${PORT}/sandbox`);
});
