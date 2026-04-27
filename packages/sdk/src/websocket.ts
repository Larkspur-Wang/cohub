import {
  realtimeEnvelopeSchema,
  type ChannelEnvelope,
  type WsClientEvent,
} from "@neta-art/cohub-protocol/realtime";
import type { ContentBlock } from "@neta-art/cohub-protocol/core";

export type WebsocketEventPayload = ChannelEnvelope;

export type WebSocketLike = {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

export type WebSocketConstructor = new (url: string) => WebSocketLike;

export type WebsocketClientOptions = {
  url?: string;
  autoReconnect?: boolean;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  pingIntervalMs?: number;
  pongTimeoutMs?: number;
  debug?: boolean;
  getAccessToken?: () => Promise<string | null> | string | null;
  WebSocketImpl?: WebSocketConstructor;
};

export type WebsocketClientState = "idle" | "connecting" | "reconnecting" | "open" | "closed";

export type WebsocketClientEvents = {
  connecting: { isReconnect: boolean; attempt: number };
  reconnecting: { attempt: number; delayMs: number; reason?: string; code?: number };
  open: { connectionId?: string | null };
  close: { code: number; reason: string; willReconnect: boolean };
  error: { error: unknown; recoverable: boolean };
  event: WebsocketEventPayload;
  ready: { connectionId: string };
  auth: { connectionId: string; user: Record<string, unknown> };
  messageAccepted: {
    requestId?: string | null;
    clientMessageId?: string | null;
    sessionId?: string | null;
    spaceId?: string | null;
  };
  serverError: {
    code?: string;
    message?: string;
    requestId?: string | null;
    sessionId?: string | null;
    spaceId?: string | null;
    clientMessageId?: string | null;
  };
  pong: { requestId?: string | null };
};

type EventHandler<T> = (payload: T) => void;

type EventMap = {
  [K in keyof WebsocketClientEvents]: Set<EventHandler<WebsocketClientEvents[K]>>;
};

const createEventMap = (): EventMap => ({
  connecting: new Set(),
  reconnecting: new Set(),
  open: new Set(),
  close: new Set(),
  error: new Set(),
  event: new Set(),
  ready: new Set(),
  auth: new Set(),
  messageAccepted: new Set(),
  serverError: new Set(),
  pong: new Set(),
});

const toWebSocketUrl = (input?: string) => {
  const base = (input?.trim() || "").replace(/\/$/, "");
  if (base) {
    if (base.startsWith("ws://") || base.startsWith("wss://")) return `${base}/ws`;
    if (base.startsWith("http://")) return `${base.replace(/^http:/, "ws:")}/ws`;
    if (base.startsWith("https://")) return `${base.replace(/^https:/, "wss:")}/ws`;
  }
  if (typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/ws`;
  }
  return "ws://localhost:8788/ws";
};

const normalizeOptions = (options: WebsocketClientOptions = {}) => ({
  url: toWebSocketUrl(options.url),
  autoReconnect: options.autoReconnect !== false,
  reconnectBaseDelayMs: options.reconnectBaseDelayMs ?? 1000,
  reconnectMaxDelayMs: options.reconnectMaxDelayMs ?? 15000,
  pingIntervalMs: options.pingIntervalMs ?? 20000,
  pongTimeoutMs: options.pongTimeoutMs ?? 15000,
  debug: options.debug === true,
});

const formatCloseMessage = (code?: number, reason?: string) =>
  `WebSocket closed: ${code ?? 0} ${reason || ""}`.trim();

const isRetryableCloseCode = (code: number) => {
  if (code === 1000) return false;
  if (code === 4003) return false;
  return true;
};

class WebsocketAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebsocketAuthError";
  }
}

export class WebsocketClient {
  private readonly url: string;
  private readonly autoReconnect: boolean;
  private readonly reconnectBaseDelayMs: number;
  private readonly reconnectMaxDelayMs: number;
  private readonly pingIntervalMs: number;
  private readonly pongTimeoutMs: number;
  private readonly debug: boolean;
  private readonly getAccessToken?: () => Promise<string | null> | string | null;
  private readonly WebSocketImpl: WebSocketConstructor;

  private ws: WebSocketLike | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private manuallyClosed = false;
  private connectPromise: Promise<void> | null = null;
  private authWaiter: {
    promise: Promise<void>;
    resolve: () => void;
    reject: (error: Error) => void;
  } | null = null;
  private awaitingPong = false;
  private lastPingRequestId: string | null = null;
  private pongDeadlineAt = 0;

  public state: WebsocketClientState = "idle";
  public connectionId: string | null = null;

  private readonly listeners = createEventMap();

  constructor(options: WebsocketClientOptions = {}) {
    const normalized = normalizeOptions(options);
    this.url = normalized.url;
    this.autoReconnect = normalized.autoReconnect;
    this.reconnectBaseDelayMs = normalized.reconnectBaseDelayMs;
    this.reconnectMaxDelayMs = normalized.reconnectMaxDelayMs;
    this.pingIntervalMs = normalized.pingIntervalMs;
    this.pongTimeoutMs = normalized.pongTimeoutMs;
    this.debug = normalized.debug;
    this.getAccessToken = options.getAccessToken;
    this.WebSocketImpl = options.WebSocketImpl ?? WebSocket;
  }

  on<K extends keyof WebsocketClientEvents>(
    type: K,
    handler: EventHandler<WebsocketClientEvents[K]>,
  ) {
    (this.listeners[type] as Set<EventHandler<WebsocketClientEvents[K]>>).add(handler);
    return () => this.off(type, handler);
  }

  off<K extends keyof WebsocketClientEvents>(
    type: K,
    handler: EventHandler<WebsocketClientEvents[K]>,
  ) {
    (this.listeners[type] as Set<EventHandler<WebsocketClientEvents[K]>>).delete(handler);
  }

  private emit<K extends keyof WebsocketClientEvents>(
    type: K,
    payload: WebsocketClientEvents[K],
  ) {
    for (const handler of this.listeners[type]) {
      handler(payload);
    }
  }

  private log(...args: unknown[]) {
    if (this.debug) console.log("[WebsocketClient]", ...args);
  }

  async connect() {
    if (this.connectPromise) return this.connectPromise;
    if (this.state === "open" && this.ws?.readyState === WebSocket.OPEN) return;

    const isReconnect = this.reconnectAttempt > 0 || this.state === "reconnecting";
    this.manuallyClosed = false;
    this.clearReconnectTimer();
    this.state = isReconnect ? "reconnecting" : "connecting";
    this.emit("connecting", { isReconnect, attempt: this.reconnectAttempt });
    this.connectPromise = new Promise<void>((resolve, reject) => {
      const ws = new this.WebSocketImpl(this.url);
      this.ws = ws;
      let settled = false;

      const rejectOnce = (error: Error) => {
        if (settled) return;
        settled = true;
        this.connectPromise = null;
        reject(error);
      };

      const resolveOnce = () => {
        if (settled) return;
        settled = true;
        this.connectPromise = null;
        resolve();
      };

      ws.onopen = async () => {
        try {
          this.log("connected", { url: this.url, isReconnect, attempt: this.reconnectAttempt });
          this.startPingLoop();
          await this.authenticate();
          this.state = "open";
          this.reconnectAttempt = 0;
          this.emit("open", { connectionId: this.connectionId });
          resolveOnce();
        } catch (error) {
          const authError =
            error instanceof Error ? error : new Error("authentication failed");
          this.emit("error", { error: authError, recoverable: false });
          rejectOnce(authError);
          ws.close(4003, authError.message);
        }
      };

      ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      ws.onerror = (error) => {
        this.emit("error", { error, recoverable: !this.manuallyClosed });
      };

      ws.onclose = (event) => {
        this.stopPingLoop();
        const wasConnecting = this.state === "connecting" || this.state === "reconnecting";
        this.state = "closed";
        this.ws = null;
        const closeError = new Error(formatCloseMessage(event.code, event.reason));
        this.rejectAuthWaiter(closeError);
        const willReconnect = !this.manuallyClosed && this.autoReconnect && isRetryableCloseCode(event.code);
        this.log("closed", { code: event.code, reason: event.reason, willReconnect, wasConnecting });
        this.emit("close", {
          code: event.code,
          reason: event.reason,
          willReconnect,
        });
        if (wasConnecting) {
          rejectOnce(closeError);
        }
        if (willReconnect) {
          void this.scheduleReconnect(event.code, event.reason);
        }
      };
    });

    return this.connectPromise;
  }

  async disconnect(code = 1000, reason = "manual") {
    this.manuallyClosed = true;
    this.clearReconnectTimer();
    this.stopPingLoop();
    this.state = "closed";
    this.rejectAuthWaiter(new Error("disconnected"));
    this.ws?.close(code, reason);
    this.ws = null;
    this.connectPromise = null;
  }

  async sendMessage(input: {
    spaceId: string;
    sessionId: string;
    content: ContentBlock[];
    clientMessageId?: string;
    requestId?: string;
    model?: string;
    provider?: string;
  }) {
    await this.ensureOpen();
    this.send({
      type: "session.message.create",
      requestId: input.requestId,
      payload: {
        spaceId: input.spaceId,
        sessionId: input.sessionId,
        content: input.content,
        clientMessageId: input.clientMessageId,
        model: input.model,
        provider: input.provider,
      },
    });
  }

  ack(eventId?: string, requestId?: string) {
    this.send({
      type: "ack",
      requestId,
      payload: eventId ? { eventId } : undefined,
    });
  }

  ping(requestId?: string) {
    const effectiveRequestId = requestId ?? `ping-${Date.now()}`;
    this.awaitingPong = true;
    this.lastPingRequestId = effectiveRequestId;
    this.pongDeadlineAt = Date.now() + this.pongTimeoutMs;
    this.send({ type: "ping", requestId: effectiveRequestId, payload: {} });
  }

  private async ensureOpen() {
    if (this.state === "open" && this.ws?.readyState === WebSocket.OPEN) return;
    await this.connect();
  }

  private send(event: WsClientEvent) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("websocket is not open");
    }
    ws.send(JSON.stringify(event));
  }

  private async authenticate() {
    const token = this.getAccessToken ? await this.getAccessToken() : null;
    if (!token) throw new WebsocketAuthError("missing access token");

    const waiter = this.createAuthWaiter();
    this.send({ type: "auth", payload: { token } });
    await waiter.promise;
  }

  private createAuthWaiter() {
    this.rejectAuthWaiter(new Error("superseded auth waiter"));
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.authWaiter = { promise, resolve, reject };
    return this.authWaiter;
  }

  private resolveAuthWaiter() {
    if (!this.authWaiter) return;
    this.authWaiter.resolve();
    this.authWaiter = null;
  }

  private rejectAuthWaiter(error: Error) {
    if (!this.authWaiter) return;
    this.authWaiter.reject(error);
    this.authWaiter = null;
  }

  private handleMessage(raw: unknown) {
    let parsed: unknown;
    try {
      parsed = typeof raw === "string" ? JSON.parse(raw) : JSON.parse(String(raw));
    } catch {
      this.emit("error", { error: new Error("invalid websocket payload"), recoverable: true });
      return;
    }

    const result = realtimeEnvelopeSchema.safeParse(parsed);
    if (!result.success) {
      this.emit("error", { error: new Error("invalid realtime envelope"), recoverable: true });
      return;
    }

    const envelope = result.data as ChannelEnvelope;
    switch (envelope.type) {
      case "system.ready": {
        const connectionId = typeof envelope.payload.connectionId === "string"
          ? envelope.payload.connectionId
          : null;
        if (connectionId) {
          this.connectionId = connectionId;
          this.emit("ready", { connectionId });
        }
        this.emit("event", envelope);
        return;
      }
      case "system.auth.ok": {
        const connectionId = typeof envelope.payload.connectionId === "string"
          ? envelope.payload.connectionId
          : this.connectionId;
        const user = envelope.payload.user && typeof envelope.payload.user === "object"
          ? (envelope.payload.user as Record<string, unknown>)
          : {};
        if (connectionId) {
          this.connectionId = connectionId;
          this.emit("auth", { connectionId, user });
        }
        this.resolveAuthWaiter();
        this.emit("event", envelope);
        return;
      }
      case "system.request.error": {
        const message = typeof envelope.payload.message === "string"
          ? envelope.payload.message
          : "request failed";
        const code = typeof envelope.payload.code === "string"
          ? envelope.payload.code
          : undefined;
        const error = new WebsocketAuthError(message);
        this.rejectAuthWaiter(error);
        this.emit("serverError", {
          code,
          message,
          requestId: envelope.requestId ?? null,
          sessionId: envelope.sessionId ?? null,
          spaceId: envelope.spaceId ?? null,
        });
        this.emit("event", envelope);
        return;
      }
      case "session.request.accepted": {
        const payload = envelope.payload as Record<string, unknown>;
        this.emit("messageAccepted", {
          requestId: envelope.requestId ?? null,
          sessionId: envelope.sessionId ?? null,
          spaceId: envelope.spaceId ?? null,
          clientMessageId:
            typeof payload.clientMessageId === "string" ? payload.clientMessageId : null,
        });
        this.emit("event", envelope);
        return;
      }
      case "session.request.error": {
        const payload = envelope.payload as Record<string, unknown>;
        this.emit("serverError", {
          code: typeof payload.code === "string" ? payload.code : undefined,
          message: typeof payload.message === "string" ? payload.message : undefined,
          requestId: envelope.requestId ?? null,
          sessionId: envelope.sessionId ?? null,
          spaceId: envelope.spaceId ?? null,
          clientMessageId:
            typeof payload.clientMessageId === "string" ? payload.clientMessageId : null,
        });
        this.emit("event", envelope);
        return;
      }
      case "system.pong": {
        const requestId = envelope.requestId ?? null;
        if (!requestId || requestId === this.lastPingRequestId) {
          this.awaitingPong = false;
          this.lastPingRequestId = null;
          this.pongDeadlineAt = 0;
        }
        this.emit("pong", { requestId });
        return;
      }
      case "system.ack.ok": {
        return;
      }
      default: {
        this.emit("event", envelope);
        return;
      }
    }
  }

  private startPingLoop() {
    this.stopPingLoop();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      if (
        this.awaitingPong &&
        this.pongDeadlineAt > 0 &&
        Date.now() > this.pongDeadlineAt
      ) {
        this.emit("error", { error: new Error("websocket pong timeout"), recoverable: true });
        this.ws.close(4002, "pong timeout");
        return;
      }
      this.ping();
    }, this.pingIntervalMs);
  }

  private stopPingLoop() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.awaitingPong = false;
    this.lastPingRequestId = null;
    this.pongDeadlineAt = 0;
  }

  private clearReconnectTimer() {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private async scheduleReconnect(code?: number, reason?: string) {
    this.clearReconnectTimer();
    const attempt = this.reconnectAttempt + 1;
    const delay = Math.min(
      this.reconnectBaseDelayMs * 2 ** this.reconnectAttempt,
      this.reconnectMaxDelayMs,
    );
    this.reconnectAttempt = attempt;
    this.state = "reconnecting";
    this.log("schedule reconnect", { attempt, delay, code, reason });
    this.emit("reconnecting", {
      attempt,
      delayMs: delay,
      code,
      reason,
    });
    await new Promise<void>((resolve) => {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        resolve();
      }, delay);
    });
    if (this.manuallyClosed) return;
    await this.connect().catch((error) => {
      this.emit("error", { error, recoverable: true });
    });
  }
}

export const createWebsocketClient = (options?: WebsocketClientOptions) =>
  new WebsocketClient(options);
