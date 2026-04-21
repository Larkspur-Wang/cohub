import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import WebSocket, { type RawData } from "ws";
import type {
  AgentSandboxMessage,
  RpcMethod,
  RpcRequestMap,
  RpcStreamEvent,
  SandboxHeartbeat,
} from "@cohub/agent-sandbox-protocol";
import { AGENT_SANDBOX_PROTOCOL_VERSION } from "@cohub/agent-sandbox-protocol";

type PendingRequest = {
  method: string;
  resolve: (value: never) => void;
  reject: (error: Error) => void;
  onStream?: (event: RpcStreamEvent) => void;
  keepUntilStreamEnd?: boolean;
  responseDelivered?: boolean;
};

type SandboxStatusHooks = {
  onHeartbeat?: (message: SandboxHeartbeat) => void | Promise<void>;
  onDisconnected?: (input: { spaceId: string; reason?: string }) => void | Promise<void>;
  onConnectionError?: (input: { spaceId: string; error: Error }) => void | Promise<void>;
};

type SandboxClientRegistration = {
  spaceId: string;
  wsUrl: string;
  started: boolean;
  connection: SandboxConnection | null;
  resolveWaiters: Array<(connection: SandboxConnection) => void>;
  hooks?: SandboxStatusHooks;
};

export class SandboxConnection {
  private readonly pending = new Map<string, PendingRequest>();

  constructor(
    readonly spaceId: string,
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
    console.log(`[SandboxWS] rpc:request spaceId=${this.spaceId} method=${method} requestId=${requestId.slice(0, 8)}`);
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, {
        method,
        resolve,
        reject,
        onStream: options.onStream,
        keepUntilStreamEnd: Boolean(options.onStream),
        responseDelivered: false,
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
      console.log(`[SandboxWS] rpc:response spaceId=${this.spaceId} method=${pending.method} requestId=${message.requestId.slice(0, 8)}`);
      pending.resolve(message.result as never);
      pending.responseDelivered = true;
      if (!pending.keepUntilStreamEnd) {
        this.pending.delete(message.requestId);
      }
      return;
    }

    if (message.type === "rpc.error") {
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      this.pending.delete(message.requestId);
      console.error(`[SandboxWS] rpc:error spaceId=${this.spaceId} method=${pending.method} requestId=${message.requestId.slice(0, 8)} error=${message.error.message}`);
      pending.reject(new Error(message.error.message));
    }
  }

  dispose(error?: Error) {
    const count = this.pending.size;
    if (count > 0) {
      console.warn(`[SandboxWS] dispose with ${count} pending requests spaceId=${this.spaceId}`);
    }
    for (const [requestId, pending] of this.pending) {
      pending.reject(error ?? new Error("sandbox connection closed"));
      this.pending.delete(requestId);
    }
  }
}

const registrations = new Map<string, SandboxClientRegistration>();

function getOrCreateRegistration(spaceId: string, wsUrl: string, hooks?: SandboxStatusHooks) {
  const existing = registrations.get(spaceId);
  if (existing) {
    if (existing.wsUrl !== wsUrl) existing.wsUrl = wsUrl;
    if (hooks) existing.hooks = hooks;
    return existing;
  }

  const created: SandboxClientRegistration = {
    spaceId,
    wsUrl,
    started: false,
    connection: null,
    resolveWaiters: [],
    hooks,
  };
  registrations.set(spaceId, created);
  return created;
}

function setActiveConnection(spaceId: string, connection: SandboxConnection | null) {
  const registration = registrations.get(spaceId);
  if (!registration) return;

  if (registration.connection && registration.connection !== connection) {
    registration.connection.dispose(new Error("sandbox connection replaced by a newer connection"));
  }

  registration.connection = connection;
  if (connection) {
    for (const resolve of registration.resolveWaiters) resolve(connection);
    registration.resolveWaiters = [];
  }
}

export async function waitForSandboxConnection(spaceId: string, timeoutMs = 30000): Promise<SandboxConnection> {
  const registration = registrations.get(spaceId);
  if (!registration) {
    throw new Error(`Sandbox client for ${spaceId} has not been started`);
  }
  if (registration.connection) return registration.connection;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      registration.resolveWaiters = registration.resolveWaiters.filter((item) => item !== onResolve);
      reject(new Error(`Timed out waiting for sandbox connection for ${spaceId} after ${timeoutMs}ms`));
    }, timeoutMs);

    const onResolve = (connection: SandboxConnection) => {
      clearTimeout(timeout);
      resolve(connection);
    };

    registration.resolveWaiters.push(onResolve);
  });
}

export async function startSandboxWsClient(input: { spaceId: string; wsUrl: string; hooks?: SandboxStatusHooks }) {
  const spaceId = input.spaceId;
  const wsUrl = input.wsUrl;
  const registration = getOrCreateRegistration(spaceId, wsUrl, input.hooks);
  if (registration.started) return;
  registration.started = true;

  void runLoop(registration);
}

export function disconnectSandboxWsClient(spaceId: string, reason = "ownership lost") {
  const registration = registrations.get(spaceId);
  if (!registration) return;
  registration.started = false;
  const connection = registration.connection;
  setActiveConnection(spaceId, null);
  connection?.dispose(new Error(reason));
  console.log(`[SandboxWS] disconnect spaceId=${spaceId} reason=${reason}`);
  void registration.hooks?.onDisconnected?.({ spaceId, reason });
}

export function getSandboxClientConnection(spaceId: string) {
  return registrations.get(spaceId)?.connection ?? null;
}

async function runLoop(registration: SandboxClientRegistration) {
  let attempt = 0;

  for (;;) {
    if (!registration.started) return;
    try {
      await connectOnce(registration);
      attempt = 0;
    } catch (error) {
      console.error(`[SandboxWS] Client loop failed for ${registration.spaceId}:`, error);
      attempt += 1;
      if (error instanceof Error) {
        void registration.hooks?.onConnectionError?.({ spaceId: registration.spaceId, error });
      }
    }

    if (!registration.started) return;
    const delayMs = Math.min(1000 * 2 ** Math.min(attempt, 5), 30000);
    await sleep(delayMs);
  }
}

async function connectOnce(registration: SandboxClientRegistration) {
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(registration.wsUrl);
    let connection: SandboxConnection | null = null;
    let settled = false;
    let firstHeartbeatAccepted = false;

    const finishResolve = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const finishReject = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    socket.on("open", () => {
      console.log(`[SandboxWS] Connected ${registration.spaceId} to ${registration.wsUrl}`);
    });

    socket.on("message", (data: RawData) => {
      try {
        const raw = typeof data === "string" ? data : data.toString("utf8");
        const message = JSON.parse(raw) as AgentSandboxMessage;

        if (message.type === "sandbox.heartbeat") {
          if (message.spaceId !== registration.spaceId) {
            socket.close();
            finishReject(new Error(`Sandbox heartbeat spaceId mismatch: expected ${registration.spaceId}, got ${message.spaceId}`));
            return;
          }
          if (!connection) {
            connection = new SandboxConnection(registration.spaceId, message.sandboxId, socket);
            setActiveConnection(registration.spaceId, connection);
            firstHeartbeatAccepted = true;
          }
          void registration.hooks?.onHeartbeat?.(message);
          return;
        }

        connection?.handleMessage(message);
      } catch (error) {
        console.error(`[SandboxWS] Failed to handle message for ${registration.spaceId}:`, error);
      }
    });

    socket.on("close", (_code, reason) => {
      connection?.dispose();
      const isStillActive = registrations.get(registration.spaceId)?.connection === connection;
      if (isStillActive) {
        setActiveConnection(registration.spaceId, null);
      }
      const reasonStr = reason?.toString() || "unknown";
      void registration.hooks?.onDisconnected?.({
        spaceId: registration.spaceId,
        reason: reasonStr,
      });
      if (!firstHeartbeatAccepted) {
        console.warn(`[SandboxWS] closed before first heartbeat spaceId=${registration.spaceId} reason=${reasonStr}`);
        finishReject(new Error(`Sandbox websocket closed before first heartbeat: ${reasonStr}`));
        return;
      }
      // If this connection was replaced by a newer one, reject so runLoop applies backoff
      // instead of immediately reconnecting and creating a tight replacement loop.
      if (!isStillActive) {
        console.warn(`[SandboxWS] closed spaceId=${registration.spaceId} reason=replaced: ${reasonStr}`);
        finishReject(new Error(`Sandbox websocket was replaced by a newer connection: ${reasonStr}`));
        return;
      }
      console.log(`[SandboxWS] closed spaceId=${registration.spaceId} reason=${reasonStr}`);
      finishResolve();
    });

    socket.on("error", (error: Error) => {
      console.error(`[SandboxWS] Socket error for ${registration.spaceId}:`, error);
      connection?.dispose(error instanceof Error ? error : new Error(String(error)));
      if (registrations.get(registration.spaceId)?.connection === connection) {
        setActiveConnection(registration.spaceId, null);
      }
      void registration.hooks?.onConnectionError?.({
        spaceId: registration.spaceId,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      finishReject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}
