import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import WebSocket, { type RawData } from "ws";
import type {
  AgentSandboxMessage,
  RpcEventPayload,
  RpcMethod,
  RpcRequestMap,
  SandboxHeartbeat,
} from "@cohub/protocol/sandbox";
import type { SpaceFsChange } from "@cohub/protocol/fs";
import type { SpacePortChange } from "@cohub/protocol/ports";
import { AGENT_SANDBOX_PROTOCOL_VERSION } from "@cohub/protocol/sandbox";
import { env } from "../env.js";
import { sendSpaceFsChanged, sendSpacePortsChanged } from "../redis.js";
import { refreshUserEnv } from "../runtime/env-cache.js";
import { logger } from "../logger.js";
import { SandboxRpcError } from "./rpc-error.js";

const ACCEPTED_RPC_DISCONNECT_GRACE_MS = 3_000;
const RECONNECT_DELAYS_MS = [250, 500, 1_000, 2_000, 5_000, 10_000, 30_000] as const;
const SANDBOX_UNAVAILABLE_MESSAGE = "Sandbox unavailable.";

function getUserFacingFailureMessage(_method: string) {
  return SANDBOX_UNAVAILABLE_MESSAGE;
}

type PendingOperation = {
  requestId: string;
  method: string;
  opId?: string;
  accepted: boolean;
  detached?: boolean;
  detachTimer?: ReturnType<typeof setTimeout>;
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
  pendingByRequestId: Map<string, PendingOperation>;
  requestIdByOpId: Map<string, string>;
};

export class SandboxConnection {
  private closed = false;
  private disposed = false;

  constructor(
    readonly spaceId: string,
    readonly sandboxId: string,
    readonly identity: string,
    readonly connectionId: string,
    private readonly socket: WebSocket,
    private readonly registration: SandboxClientRegistration,
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
    logger.debug(`[SandboxWS] rpc:request spaceId=${this.spaceId} identity=${this.identity} method=${method} requestId=${requestId.slice(0, 8)}`);
    return new Promise((resolve, reject) => {
      const pending = {
        requestId,
        method,
        accepted: false,
        resolve,
        reject,
        onEvent: options.onEvent,
      };
      this.registration.pendingByRequestId.set(requestId, pending);

      try {
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
      } catch (error) {
        this.clearPending(requestId, pending);
        reject(new SandboxRpcError(getUserFacingFailureMessage(method), {
          method,
          rpcErrorCode: "IO_ERROR",
          retryable: false,
          transportReason: error instanceof Error ? error.message : String(error),
        }));
      }
    });
  }

  handleMessage(message: AgentSandboxMessage) {
    if (message.type === "rpc.accepted") {
      const pending = this.registration.pendingByRequestId.get(message.requestId);
      if (!pending) return;
      pending.accepted = true;
      pending.opId = message.opId;
      this.registration.requestIdByOpId.set(message.opId, message.requestId);
      logger.debug(`[SandboxWS] rpc:accepted spaceId=${this.spaceId} identity=${this.identity} method=${pending.method} requestId=${message.requestId.slice(0, 8)} opId=${message.opId.slice(0, 8)}`);
      return;
    }

    if (message.type === "rpc.event") {
      const pending = this.registration.pendingByRequestId.get(this.registration.requestIdByOpId.get(message.opId) ?? "");
      pending?.onEvent?.(message.event);
      return;
    }

    if (message.type === "rpc.completed") {
      const requestId = this.registration.requestIdByOpId.get(message.opId) ?? message.requestId;
      const pending = this.registration.pendingByRequestId.get(requestId);
      if (!pending) return;
      logger.debug(`[SandboxWS] rpc:completed spaceId=${this.spaceId} identity=${this.identity} method=${pending.method} requestId=${requestId.slice(0, 8)} opId=${message.opId.slice(0, 8)}`);
      this.clearPending(requestId, pending, message.opId);
      pending.resolve(message.result as never);
      return;
    }

    if (message.type === "rpc.failed") {
      const requestId = this.registration.requestIdByOpId.get(message.opId) ?? message.requestId;
      const pending = this.registration.pendingByRequestId.get(requestId);
      if (!pending) return;
      this.clearPending(requestId, pending, message.opId);
      logger.warn(`[SandboxWS] rpc:failed spaceId=${this.spaceId} identity=${this.identity} method=${pending.method} requestId=${requestId.slice(0, 8)} opId=${message.opId.slice(0, 8)} rpcErrorCode=${message.error.code} retryable=${message.error.retryable ?? false}`);
      pending.reject(new SandboxRpcError(message.error.message, {
        method: pending.method,
        rpcErrorCode: message.error.code,
        retryable: message.error.retryable ?? false,
        transportReason: message.error.message,
      }));
    }
  }

  dispose(error?: Error) {
    if (this.disposed) return;
    this.disposed = true;

    const pendingEntries = [...this.registration.pendingByRequestId.entries()];
    if (pendingEntries.length === 0) return;

    const unaccepted = pendingEntries.filter(([, pending]) => !pending.accepted);
    const accepted = pendingEntries.length - unaccepted.length;
    logger.warn(`[SandboxWS] dispose pending requests spaceId=${this.spaceId} identity=${this.identity} accepted=${accepted} unaccepted=${unaccepted.length} error=${error?.message ?? "connection closed"}`);

    for (const [requestId, pending] of pendingEntries) {
      if (!pending.accepted) {
        this.clearPending(requestId, pending);
        pending.reject(new SandboxRpcError(getUserFacingFailureMessage(pending.method), {
          method: pending.method,
          rpcErrorCode: "IO_ERROR",
          retryable: false,
          transportReason: error?.message ?? "connection closed",
        }));
        continue;
      }

      if (pending.detachTimer) continue;
      pending.detached = true;
      pending.detachTimer = setTimeout(() => {
        const current = this.registration.pendingByRequestId.get(pending.requestId);
        if (current !== pending) return;
        logger.warn(`[SandboxWS] accepted rpc did not complete after disconnect grace spaceId=${this.spaceId} identity=${this.identity} method=${pending.method} requestId=${pending.requestId.slice(0, 8)} opId=${pending.opId?.slice(0, 8) ?? "none"}`);
        this.clearPending(requestId, pending);
        pending.reject(new SandboxRpcError(getUserFacingFailureMessage(pending.method), {
          method: pending.method,
          rpcErrorCode: "IO_ERROR",
          retryable: false,
          transportReason: error?.message ?? "connection closed",
        }));
      }, ACCEPTED_RPC_DISCONNECT_GRACE_MS);
    }
  }

  private clearPending(requestId: string, pending: PendingOperation, opId = pending.opId) {
    if (pending.detachTimer) {
      clearTimeout(pending.detachTimer);
      pending.detachTimer = undefined;
    }
    this.registration.pendingByRequestId.delete(pending.requestId);
    if (requestId !== pending.requestId) {
      this.registration.pendingByRequestId.delete(requestId);
    }
    if (opId) {
      this.registration.requestIdByOpId.delete(opId);
    }
  }

  close(reason = "sandbox connection closed") {
    if (this.closed) return;
    this.closed = true;
    try {
      this.socket.close(1000, reason);
    } catch (error) {
      console.warn(`[SandboxWS] Failed to close socket spaceId=${this.spaceId} identity=${this.identity}`, error);
    }
  }
}

const registrations = new Map<string, SandboxClientRegistration>();

function callHookSafely(
  spaceId: string,
  hookName: "onHeartbeat" | "onDisconnected" | "onConnectionError",
  fn: (() => void | Promise<void>) | undefined,
) {
  if (!fn) return;
  void Promise.resolve()
    .then(fn)
    .catch((error) => {
      console.error(`[SandboxWS] Hook ${hookName} failed for ${spaceId}:`, error);
    });
}

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
    pendingByRequestId: new Map(),
    requestIdByOpId: new Map(),
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
    previous.dispose(new Error("sandbox connection replaced"));
    previous.close("sandbox connection replaced");
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
  const previous = registration.connection;
  setActiveConnection(spaceId, null);

  if (registration.pendingByRequestId.size > 0) {
    console.warn(`[SandboxWS] disconnect rejecting ${registration.pendingByRequestId.size} accepted requests spaceId=${spaceId} reason=${reason}`);
  }
  for (const [requestId, pending] of registration.pendingByRequestId) {
    if (pending.detachTimer) {
      clearTimeout(pending.detachTimer);
      pending.detachTimer = undefined;
    }
    pending.reject(new Error(getUserFacingFailureMessage(pending.method)));
    registration.pendingByRequestId.delete(requestId);
    if (pending.opId) {
      registration.requestIdByOpId.delete(pending.opId);
    }
  }

  previous?.close(reason);
  logger.info(`[SandboxWS] disconnect spaceId=${spaceId} reason=${reason}`);
  callHookSafely(spaceId, "onDisconnected", () => registration.hooks?.onDisconnected?.({ spaceId, reason }));
}

export function getSandboxClientConnection(spaceId: string) {
  return registrations.get(spaceId)?.connection ?? null;
}

export function hasPendingSandboxRequests(spaceId: string) {
  return (registrations.get(spaceId)?.pendingByRequestId.size ?? 0) > 0;
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
        callHookSafely(registration.spaceId, "onConnectionError", () => registration.hooks?.onConnectionError?.({
          spaceId: registration.spaceId,
          error,
        }));
      }
    }

    if (!registration.started) return;
    const delayMs = RECONNECT_DELAYS_MS[Math.min(Math.max(attempt - 1, 0), RECONNECT_DELAYS_MS.length - 1)];
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
    let attachSent = false;
    const attachRequestId = randomUUID();

    const isActiveConnection = () => registrations.get(registration.spaceId)?.connection === connection;

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
      logger.info(`[SandboxWS] Connected ${registration.spaceId} to ${registration.wsUrl}`);
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
          const setup = message.metadata?.setup;
          if (setup) {
            if (setup.ran) {
              if (setup.exitCode === 0 && !setup.error) {
                logger.debug(`[SandboxWS] setup.sh completed ok spaceId=${registration.spaceId} duration=${setup.duration}`);
              } else {
                console.warn(`[SandboxWS] setup.sh failed spaceId=${registration.spaceId} exitCode=${setup.exitCode} duration=${setup.duration} error=${setup.error ?? "unknown"}`);
              }
            } else {
              logger.debug(`[SandboxWS] setup.sh not found, skipped spaceId=${registration.spaceId}`);
            }
          }
          callHookSafely(registration.spaceId, "onHeartbeat", () => registration.hooks?.onHeartbeat?.(message));
          if (!attachSent) {
            attachSent = true;
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
          connection = new SandboxConnection(registration.spaceId, heartbeat.sandboxId, message.identity, message.connectionId, socket, registration);
          setActiveConnection(registration.spaceId, connection);
          void refreshUserEnv(registration.spaceId).catch((err) => {
            console.warn(`[SandboxWS] Failed to refresh env for ${registration.spaceId}: ${err instanceof Error ? err.message : String(err)}`);
          });
          const setupSummary = heartbeat.metadata?.setup
            ? heartbeat.metadata.setup.ran
              ? heartbeat.metadata.setup.exitCode === 0 && !heartbeat.metadata.setup.error
                ? `setup=ok(${heartbeat.metadata.setup.duration})`
                : `setup=failed(exitCode=${heartbeat.metadata.setup.exitCode}, duration=${heartbeat.metadata.setup.duration})`
              : "setup=skipped"
            : "setup=unknown";
          logger.info(`[SandboxWS] attached spaceId=${registration.spaceId} identity=${message.identity} connectionId=${message.connectionId.slice(0, 8)} status=${heartbeat.status} ${setupSummary}`);
          return;
        }

        const typedMessage = message as AgentSandboxMessage | { type: "fs.changed"; payload: { resync: boolean; changes: SpaceFsChange[]; seq: number } } | { type: "ports.changed"; payload: { resync: boolean; ports: SpacePortChange[]; seq: number } };
        if (typedMessage.type === "fs.changed") {
          void sendSpaceFsChanged(registration.spaceId, {
            source: typedMessage.payload.resync && typedMessage.payload.changes.length === 0 ? "sandbox-watch-started" : "sandbox-inotify",
            seq: typedMessage.payload.seq,
            resync: typedMessage.payload.resync,
            changes: typedMessage.payload.changes,
          });
          return;
        }

        if (typedMessage.type === "ports.changed") {
          void sendSpacePortsChanged(registration.spaceId, {
            source: typedMessage.payload.resync && typedMessage.payload.ports.length === 0 ? "sandbox-port-watch-started" : "sandbox-port-watch",
            seq: typedMessage.payload.seq,
            resync: typedMessage.payload.resync,
            ports: typedMessage.payload.ports,
          });
          return;
        }

        connection?.handleMessage(message);
      } catch (error) {
        console.error(`[SandboxWS] Failed to handle message for ${registration.spaceId}:`, error);
      }
    });

    socket.on("close", (_code, reason) => {
      connection?.dispose();
      const reasonStr = reason?.toString() || "unknown";
      const isActive = isActiveConnection();
      if (isActive) {
        setActiveConnection(registration.spaceId, null);
        callHookSafely(registration.spaceId, "onDisconnected", () => registration.hooks?.onDisconnected?.({
          spaceId: registration.spaceId,
          reason: reasonStr,
        }));
      }
      if (!attached) {
        console.warn(`[SandboxWS] closed before attach spaceId=${registration.spaceId} reason=${reasonStr}`);
        finishReject(new Error(`Sandbox websocket closed before attach: ${reasonStr}`));
        return;
      }
      if (isActive) {
        logger.debug(`[SandboxWS] closed spaceId=${registration.spaceId} reason=${reasonStr}`);
      } else {
        logger.debug(`[SandboxWS] stale connection closed spaceId=${registration.spaceId} reason=${reasonStr}`);
      }
      finishResolve();
    });

    socket.on("error", (error: Error) => {
      console.error(`[SandboxWS] Socket error for ${registration.spaceId}:`, error);
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      connection?.dispose(normalizedError);
      const isActive = isActiveConnection();
      if (isActive) {
        setActiveConnection(registration.spaceId, null);
        callHookSafely(registration.spaceId, "onConnectionError", () => registration.hooks?.onConnectionError?.({
          spaceId: registration.spaceId,
          error: normalizedError,
        }));
      } else {
        console.warn(`[SandboxWS] stale connection error ignored spaceId=${registration.spaceId} error=${normalizedError.message}`);
      }
      finishReject(normalizedError);
    });
  });
}
