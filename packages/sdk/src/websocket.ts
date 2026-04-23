import {
  realtimeEnvelopeSchema,
  type ContentBlock,
  type ChannelEnvelope,
  type WsClientEvent,
} from "@cohub/protocol";

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

export type WebsocketClientState = "idle" | "connecting" | "open" | "closed";

export type WebsocketClientEvents = {
  open: { connectionId?: string | null };
  close: { code: number; reason: string; willReconnect: boolean };
  error: { error: unknown };
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

const stableOptionsKey = (options: WebsocketClientOptions = {}) =>
  JSON.stringify(normalizeOptions(options));

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

    this.manuallyClosed = false;
    this.state = "connecting";
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
          this.log("connected", this.url);
          this.startPingLoop();
          await this.authenticate();
          this.state = "open";
          this.reconnectAttempt = 0;
          this.emit("open", { connectionId: this.connectionId });
          resolveOnce();
        } catch (error) {
          const authError =
            error instanceof Error ? error : new Error("authentication failed");
          rejectOnce(authError);
          ws.close(4003, authError.message);
        }
      };

      ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      ws.onerror = (error) => {
        this.emit("error", { error });
      };

      ws.onclose = (event) => {
        this.stopPingLoop();
        const wasConnecting = this.state === "connecting";
        this.state = "closed";
        this.ws = null;
        this.rejectAuthWaiter(
          new Error(`WebSocket closed: ${event.code} ${event.reason || ""}`.trim()),
        );
        const willReconnect = !this.manuallyClosed && this.autoReconnect;
        this.emit("close", {
          code: event.code,
          reason: event.reason,
          willReconnect,
        });
        if (wasConnecting) {
          rejectOnce(new Error(`WebSocket closed: ${event.code} ${event.reason || ""}`.trim()));
          // 4001 = server-side Redis key expired, a fresh connection will create a new key.
          // Schedule reconnect so the client recovers even if it was rejected during connect.
          if (event.code === 4001 && willReconnect) {
            void this.scheduleReconnect();
          }
          return;
        }
        if (willReconnect) {
          void this.scheduleReconnect();
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

  private async authenticate() {
    if (this.authWaiter) return this.authWaiter.promise;

    const token = await this.getAccessToken?.();
    if (!token) throw new WebsocketAuthError("authentication token is missing");

    let resolveAuth!: () => void;
    let rejectAuth!: (error: Error) => void;
    const promise = new Promise<void>((resolve, reject) => {
      resolveAuth = resolve;
      rejectAuth = reject;
    });
    this.authWaiter = { promise, resolve: resolveAuth, reject: rejectAuth };

    try {
      this.send({
        type: "auth",
        requestId: `auth-${Date.now()}`,
        payload: { token },
      });
      await promise;
    } finally {
      this.authWaiter = null;
    }
  }

  private resolveAuthWaiter() {
    this.authWaiter?.resolve();
  }

  private rejectAuthWaiter(error: Error) {
    this.authWaiter?.reject(error);
  }

  private send(message: WsClientEvent) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("websocket is not connected");
    }
    let serialized = "";
    try {
      serialized = JSON.stringify(message);
    } catch (error) {
      throw new Error(
        `failed to serialize websocket message: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    ws.send(serialized);
  }

  private handleMessage(raw: unknown) {
    try {
      const text = typeof raw === "string" ? raw : String(raw);
      const parsed = realtimeEnvelopeSchema.safeParse(JSON.parse(text));
      if (!parsed.success) {
        this.log("ignored invalid server message", parsed.error.issues);
        return;
      }
      this.routeEnvelope(parsed.data);
    } catch (error) {
      this.emit("error", { error });
    }
  }

  private routeEnvelope(envelope: ChannelEnvelope) {
    const payload = envelope.payload;

    switch (envelope.type) {
      case "system.ready": {
        const connectionId =
          typeof payload.connectionId === "string" ? payload.connectionId : "";
        if (connectionId) this.connectionId = connectionId;
        this.emit("ready", { connectionId });
        return;
      }
      case "system.auth.ok": {
        const connectionId =
          typeof payload.connectionId === "string"
            ? payload.connectionId
            : this.connectionId ?? "";
        this.connectionId = connectionId || null;
        this.resolveAuthWaiter();
        this.emit("auth", {
          connectionId,
          user: (payload.user as Record<string, unknown> | undefined) ?? {},
        });
        return;
      }
      case "session.request.accepted": {
        this.emit("messageAccepted", {
          requestId: envelope.requestId ?? null,
          clientMessageId:
            typeof payload.clientMessageId === "string" ? payload.clientMessageId : null,
          sessionId: envelope.sessionId ?? null,
          spaceId: envelope.spaceId ?? null,
        });
        return;
      }
      case "session.request.error":
      case "system.request.error": {
        const message =
          typeof payload.message === "string" ? payload.message : "unknown websocket error";
        this.rejectAuthWaiter(new WebsocketAuthError(message));
        this.emit("serverError", {
          code: typeof payload.code === "string" ? payload.code : undefined,
          message,
          requestId: envelope.requestId ?? null,
          sessionId: envelope.sessionId ?? null,
          spaceId: envelope.spaceId ?? null,
          clientMessageId:
            typeof payload.clientMessageId === "string" ? payload.clientMessageId : null,
        });
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
        this.emit("error", { error: new Error("websocket pong timeout") });
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

  private async scheduleReconnect() {
    this.clearReconnectTimer();
    const delay = Math.min(
      this.reconnectBaseDelayMs * 2 ** this.reconnectAttempt,
      this.reconnectMaxDelayMs,
    );
    this.reconnectAttempt += 1;
    await new Promise<void>((resolve) => {
      this.reconnectTimer = setTimeout(() => resolve(), delay);
    });
    if (this.manuallyClosed) return;
    await this.connect().catch((error) => {
      this.emit("error", { error });
    });
  }
}

let sharedWebsocketClient: WebsocketClient | null = null;
let sharedWebsocketClientOptionsKey: string | null = null;

export const createWebsocketClient = (options?: WebsocketClientOptions) =>
  new WebsocketClient(options);

export const getWebsocketClient = (options?: WebsocketClientOptions) => {
  const nextKey = stableOptionsKey(options);
  if (!sharedWebsocketClient) {
    sharedWebsocketClient = new WebsocketClient(options);
    sharedWebsocketClientOptionsKey = nextKey;
    return sharedWebsocketClient;
  }
  if (
    sharedWebsocketClientOptionsKey &&
    sharedWebsocketClientOptionsKey !== nextKey
  ) {
    console.warn(
      "[WebsocketClient] getWebsocketClient() called with different options after singleton creation. Existing singleton will be reused.",
    );
  }
  return sharedWebsocketClient;
};
