import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import WebSocket, { type RawData } from "ws";
import type {
  AgentSandboxMessage,
  RpcFailed,
  RpcMethod,
  RpcRequestMap,
  RpcEventPayload,
  SandboxHeartbeat,
} from "@cohub/agent-sandbox-protocol";
import { AGENT_SANDBOX_PROTOCOL_VERSION } from "@cohub/agent-sandbox-protocol";
import { env } from "../env.js";

type PendingRequest = {
  method: string;
  opId?: string;
  resolve: (value: never) => void;
  reject: (error: Error) => void;
  onEvent?: (event: RpcEventPayload) => void;
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
  private readonly pendingByRequestId = new Map<string, PendingRequest>();
  private readonly requestIdByOpId = new Map<string, string>();

  constructor(
    readonly spaceId: string,
    readonly sandboxId: string,
    readonly identity: string,
    readonly connectionId: string,
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
      onEvent?: (event: RpcEventPayload) => void;
    },
  ): Promise<RpcRequestMap[M]["result"]> {
    const requestId = options.requestId ?? randomUUID();
    console.log(`[SandboxWS] rpc:request spaceId=${this.spaceId} identity=${this.identity} method=${method} requestId=${requestId.slice(0, 8)}`);
    return new Promise((resolve, reject) => {
      this.pendingByRequestId.set(requestId, {
        method,
        resolve,
        reject,
        onEvent: options.onEvent,
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
    if (message.type === "rpc.accepted") {
      const pending = this.pendingByRequestId.get(message.requestId);
      if (!pending) return;
      pending.opId = message.opId;
      this.requestIdByOpId.set(message.opId, message.requestId);
      console.log(`[SandboxWS] rpc:accepted spaceId=${this.spaceId} identity=${this.identity} method=${pending.method} requestId=${message.requestId.slice(0, 8)} opId=${message.opId.slice(0, 8)}`);
      return;
    }

    if (message.type === "rpc.event") {
      const pending = this.pendingByRequestId.get(this.requestIdByOpId.get(message.opId) ?? "");
      if (!pending) {
        console.warn(`[SandboxWS] rpc:event without pending request spaceId=${this.spaceId} identity=${this.identity} opId=${message.opId.slice(0, 8)} event=${message.event.type}`);
        return;
      }
      pending.onEvent?.(message.event);
      return;
    }

    if (message.type === "rpc.completed") {
      const requestId = this.requestIdByOpId.get(message.opId) ?? message.requestId;
      const pending = this.pendingByRequestId.get(requestId);
      if (!pending) return;
      console.log(`[SandboxWS] rpc:completed spaceId=${this.spaceId} identity=${this.identity} method=${pending.method} requestId=${requestId.slice(0, 8)} opId=${message.opId.slice(0, 8)}`);
      this.pendingByRequestId.delete(requestId);
      this.requestIdByOpId.delete(message.opId);
      pending.resolve(message.result as never);
      return;
    }

    if (message.type === "rpc.failed") {
      const requestId = this.requestIdByOpId.get(message.opId) ?? message.requestId;
      const pending = this.pendingByRequestId.get(requestId);
      if (!pending) return;
      this.pendingByRequestId.delete(requestId);
      this.requestIdByOpId.delete(message.opId);
      console.error(`[SandboxWS] rpc:failed spaceId=${this.spaceId} identity=${this.identity} method=${pending.method} requestId=${requestId.slice(0, 8)} opId=${message.opId.slice(0, 8)} error=${message.error.message}`);
      pending.reject(new Error(message.error.message));
    }
  }

  dispose(error?: Error) {
    const count = this.pendingByRequestId.size;
    if (count > 0) {
      console.warn(`[SandboxWS] dispose with ${count} pending requests spaceId=${this.spaceId} identity=${this.identity}`);
    }
    for (const [requestId, pending] of this.pendingByRequestId) {
      pending.reject(error ?? new Error("sandbox connection closed"));
      this.pendingByRequestId.delete(requestId);
      if (pending.opId) {
        this.requestIdByOpId.delete(pending.opId);
      }
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

  const previous = registration.connection;
  registration.connection = connection;
  if (connection) {
    for (const resolve of registration.resolveWaiters) resolve(connection);
    registration.resolveWaiters = [];
  }
  if (previous && previous !== connection) {
    previous.dispose(new Error("sandbox connection superseded by a newer local connection"));
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
    let heartbeat: SandboxHeartbeat | null = null;
    let connection: SandboxConnection | null = null;
    let attached = false;
    let settled = false;
    const attachRequestId = randomUUID();

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
          heartbeat = message;
          void registration.hooks?.onHeartbeat?.(message);
          if (!attached) {
            socket.send(JSON.stringify({
              version: AGENT_SANDBOX_PROTOCOL_VERSION,
              type: "session.attach",
              requestId: attachRequestId,
              spaceId: registration.spaceId,
              sandboxId: message.sandboxId,
              timestamp: Date.now(),
              identity: env.AGENT_INSTANCE_ID,
            }));
          }
          return;
        }

        if (message.type === "session.attach.ok") {
          if (message.requestId !== attachRequestId) return;
          if (!heartbeat) {
            finishReject(new Error(`Sandbox attach ok received before heartbeat for ${registration.spaceId}`));
            return;
          }
          attached = true;
          connection = new SandboxConnection(registration.spaceId, heartbeat.sandboxId, message.identity, message.connectionId, socket);
          setActiveConnection(registration.spaceId, connection);
          console.log(`[SandboxWS] attached spaceId=${registration.spaceId} identity=${message.identity} connectionId=${message.connectionId.slice(0, 8)}`);
          return;
        }

        connection?.handleMessage(message);
      } catch (error) {
        console.error(`[SandboxWS] Failed to handle message for ${registration.spaceId}:`, error);
      }
    });

    socket.on("close", (_code, reason) => {
      connection?.dispose();
      if (registrations.get(registration.spaceId)?.connection === connection) {
        setActiveConnection(registration.spaceId, null);
      }
      const reasonStr = reason?.toString() || "unknown";
      void registration.hooks?.onDisconnected?.({
        spaceId: registration.spaceId,
        reason: reasonStr,
      });
      if (!attached) {
        console.warn(`[SandboxWS] closed before attach spaceId=${registration.spaceId} reason=${reasonStr}`);
        finishReject(new Error(`Sandbox websocket closed before attach: ${reasonStr}`));
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
