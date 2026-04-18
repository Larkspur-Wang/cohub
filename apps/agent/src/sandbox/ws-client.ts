import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import WebSocket, { type RawData } from "ws";
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
    private readonly socket: WebSocket,
  ) {}

  send(message: AgentSandboxMessage) {
    this.socket.send(JSON.stringify(message));
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
let clientStarted = false;

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

export async function startSandboxWsClient() {
  if (clientStarted) return;
  clientStarted = true;

  void runLoop();
}

async function runLoop() {
  let attempt = 0;

  for (;;) {
    try {
      await connectOnce();
      attempt = 0;
    } catch (error) {
      console.error("[SandboxWS] Client loop failed:", error);
      attempt += 1;
    }

    const delayMs = Math.min(1000 * 2 ** Math.min(attempt, 5), 30000);
    await sleep(delayMs);
  }
}

async function connectOnce() {
  await new Promise<void>((resolve) => {
    const socket = new WebSocket(env.SANDBOX_WS_URL);
    let connection: SandboxConnection | null = null;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    socket.on("open", () => {
      console.log(`[SandboxWS] Connected to ${env.SANDBOX_WS_URL}`);
    });

    socket.on("message", (data: RawData) => {
      try {
        const raw = typeof data === "string" ? data : data.toString("utf8");
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
          return;
        }

        if (message.type === "sandbox.heartbeat") {
          return;
        }

        connection?.handleMessage(message);
      } catch (error) {
        console.error("[SandboxWS] Failed to handle message:", error);
      }
    });

    socket.on("close", () => {
      connection?.dispose();
      if (activeConnection === connection) setActiveConnection(null);
      finish();
    });

    socket.on("error", (error: Error) => {
      console.error("[SandboxWS] Socket error:", error);
      connection?.dispose(error instanceof Error ? error : new Error(String(error)));
      if (activeConnection === connection) setActiveConnection(null);
      finish();
    });
  });
}
