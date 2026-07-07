import type { Permission } from "./types.js";

export type WorkRuntimeContext = {
  work: { id: string; slug: string; url?: string | null };
  space: { id: string; name?: string | null };
  viewer?: { userUuid: string } | null;
  permissions?: { scopes: Permission[]; workScopes: Permission[]; viewerScopes: Permission[] };
};

export type WorkRuntimeCheckoutStatus = "success" | "failed" | "cancel" | null;

export type WorkRuntimeCheckoutState = {
  status: WorkRuntimeCheckoutStatus;
  orderId: string | null;
};

type RuntimeResponse =
  | { type: "cohub.work.context.result"; requestId: string; context: WorkRuntimeContext }
  | { type: "cohub.work.token.result"; requestId: string; token: string | null }
  | { type: "cohub.work.authorize.result"; requestId: string; token: string | null }
  | { type: "cohub.work.purchase.result"; requestId: string; checkout: { providerKey: string | null; checkoutUrl: string | null; checkoutUsable: boolean; status: string | null; message: string | null; orderId: string; productKey: string } | null }
  | { type: "cohub.work.checkout-state.result"; requestId: string; status: WorkRuntimeCheckoutStatus; orderId: string | null }
  | { type: "cohub.work.error"; requestId: string; message: string };

/**
 * Options for a single work runtime transport request.
 */
export type WorkRuntimeRequestOptions = {
  /** How long to wait for a matching response before resolving with null. */
  timeoutMs?: number;
  /** When set, re-posts the request on this interval until a response arrives. */
  retryIntervalMs?: number;
};

/**
 * Transport layer for {@link WorkRuntimeApi}. Decoupled so the same API can run
 * over either the iframe parent bridge (bridge mode) or a popup broker window
 * (broker mode). The transport is responsible for posting the request and
 * resolving with the first matching response (or null on timeout).
 */
export interface WorkRuntimeTransport {
  request<T>(
    message: Record<string, unknown>,
    options?: WorkRuntimeRequestOptions,
  ): Promise<T | null>;
}

const isBrowser = () => typeof window !== "undefined" && typeof window.parent !== "undefined";
const hasParent = () => isBrowser() && window.parent !== window;
const getParentOrigin = () => {
  if (!isBrowser()) return null;
  const ancestorOrigin = window.location.ancestorOrigins?.[0];
  if (typeof ancestorOrigin === "string" && ancestorOrigin) return ancestorOrigin;
  try {
    return document.referrer ? new URL(document.referrer).origin : null;
  } catch {
    return null;
  }
};

const generateRequestId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

/**
 * Bridge-mode transport: posts messages to `window.parent` (the Cohub host
 * embedding the work in an iframe) and listens for the matching reply.
 * Behaviorally identical to the previous module-level `request()` helper.
 */
export class ParentBridgeTransport implements WorkRuntimeTransport {
  private trustedParentOrigin: string | null = null;

  request<T>(
    message: Record<string, unknown>,
    options?: WorkRuntimeRequestOptions,
  ): Promise<T | null> {
    const timeoutMs = options?.timeoutMs ?? 1_200;
    const retryIntervalMs = options?.retryIntervalMs;
    if (!hasParent()) return Promise.resolve(null);
    const requestId = generateRequestId();
    return new Promise((resolve, reject) => {
      let retryTimer: ReturnType<typeof setInterval> | null = null;
      const parentOrigin = this.trustedParentOrigin ?? getParentOrigin();
      const postRequest = () => {
        try {
          window.parent.postMessage({ ...message, requestId }, parentOrigin ?? "*");
        } catch {
          return;
        }
      };
      const cleanup = () => {
        clearTimeout(timer);
        if (retryTimer) clearInterval(retryTimer);
        window.removeEventListener("message", onMessage);
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve(null);
      }, timeoutMs);
      const onMessage = (event: MessageEvent<RuntimeResponse>) => {
        if (event.source !== window.parent) return;
        if (parentOrigin && event.origin !== parentOrigin) return;
        const data = event.data;
        if (!data || data.requestId !== requestId) return;
        cleanup();
        this.trustedParentOrigin = event.origin;
        if (data.type === "cohub.work.error") {
          reject(new Error(data.message));
          return;
        }
        resolve(data as T);
      };
      window.addEventListener("message", onMessage);
      postRequest();
      if (retryIntervalMs) retryTimer = setInterval(postRequest, retryIntervalMs);
    });
  }
}

/**
 * Broker-mode transport for standalone-deployed works. Opens a popup window to
 * the Cohub auth broker page, performs a ready-handshake, sends the request via
 * postMessage, and resolves with the broker's response. The popup is closed
 * after a single request is fulfilled (one-shot, per §7.2 of the plan).
 *
 * Non-interactive messages (`context`, `checkout-state`) are answered locally
 * without opening a popup — the work already knows its own workId, and
 * checkout state is not available on the work's own origin in broker mode.
 */
export class PopupBrokerTransport implements WorkRuntimeTransport {
  private readonly brokerOrigin: string;
  private readonly workId: string;

  constructor(config: { brokerOrigin: string; workId: string }) {
    this.brokerOrigin = config.brokerOrigin;
    this.workId = config.workId;
  }

  request<T>(
    message: Record<string, unknown>,
    options?: WorkRuntimeRequestOptions,
  ): Promise<T | null> {
    // Non-interactive messages are answered locally to avoid popping up a
    // window for data the work already has (or cannot have).
    if (message.type === "cohub.work.context") {
      return Promise.resolve({
        type: "cohub.work.context.result",
        context: {
          work: { id: this.workId, slug: "", url: null },
          space: { id: "" },
          permissions: { scopes: [], workScopes: [], viewerScopes: [] },
        },
      } as T);
    }
    if (message.type === "cohub.work.checkout-state") {
      return Promise.resolve({
        type: "cohub.work.checkout-state.result",
        status: null,
        orderId: null,
      } as T);
    }

    const timeoutMs = options?.timeoutMs ?? 120_000;
    const requestId = generateRequestId();

    return new Promise<T | null>((resolve, reject) => {
      if (typeof window === "undefined" || typeof window.open !== "function") {
        resolve(null);
        return;
      }

      const workOrigin = window.location.origin;
      const brokerUrl = `${this.brokerOrigin}/work-auth?work=${encodeURIComponent(this.workId)}&origin=${encodeURIComponent(workOrigin)}`;

      const popup = window.open(brokerUrl, "cohub-work-auth", "popup,width=480,height=640");
      if (!popup) {
        reject(new Error("Failed to open authorization window. Please allow popups for this site."));
        return;
      }

      let ready = false;
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let closeChecker: ReturnType<typeof setInterval> | null = null;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (closeChecker) clearInterval(closeChecker);
        window.removeEventListener("message", onMessage);
        try { popup.close(); } catch { /* ignore */ }
        fn();
      };

      timer = setTimeout(() => {
        finish(() => {
          if (!ready) reject(new Error("Authorization window did not respond in time."));
          else resolve(null);
        });
      }, timeoutMs);

      const onMessage = (event: MessageEvent<RuntimeResponse | { type: string; requestId?: string }>) => {
        if (event.source !== popup) return;
        if (event.origin !== this.brokerOrigin) return;
        const data = event.data;
        if (!data) return;

        // Handshake: broker signals it's ready to receive the actual request.
        if (data.type === "cohub.work.broker.ready" && !ready) {
          ready = true;
          try {
            popup.postMessage({ ...message, requestId }, this.brokerOrigin);
          } catch {
            finish(() => reject(new Error("Failed to send request to authorization window.")));
          }
          return;
        }

        // Response to our request.
        if (data.requestId !== requestId) return;
        finish(() => {
          if (data.type === "cohub.work.error") {
            reject(new Error((data as { message: string }).message));
            return;
          }
          resolve(data as T);
        });
      };

      window.addEventListener("message", onMessage);

      // Safety: if the popup closes before responding, reject.
      closeChecker = setInterval(() => {
        if (popup.closed) {
          finish(() => {
            if (!ready) reject(new Error("Authorization window was closed."));
            else resolve(null);
          });
        }
      }, 500);
    });
  }
}

const TOKEN_STORAGE_PREFIX = "cohub:work-token";

export class WorkRuntimeApi {
  private token: string | null = null;
  private readonly transport: WorkRuntimeTransport;
  private readonly tokenStorageKey: string | null;

  constructor(
    transport: WorkRuntimeTransport = new ParentBridgeTransport(),
    workId?: string,
  ) {
    this.transport = transport;
    this.tokenStorageKey = workId ? `${TOKEN_STORAGE_PREFIX}:${workId}` : null;
    // Restore a cached token from localStorage (broker-mode UX optimization;
    // see §0 — this is not a security measure).
    this.token = this.readStoredToken();
  }

  private readStoredToken(): string | null {
    if (!this.tokenStorageKey || typeof localStorage === "undefined") return null;
    try {
      return localStorage.getItem(this.tokenStorageKey);
    } catch {
      return null;
    }
  }

  private writeStoredToken(token: string | null) {
    if (!this.tokenStorageKey || typeof localStorage === "undefined") return;
    try {
      if (token) localStorage.setItem(this.tokenStorageKey, token);
      else localStorage.removeItem(this.tokenStorageKey);
    } catch {
      // ignore storage failures (quota, privacy mode)
    }
  }

  async context() {
    const response = await this.transport.request<{ context: WorkRuntimeContext }>(
      { type: "cohub.work.context" },
      { timeoutMs: 8_000, retryIntervalMs: 250 },
    );
    return response?.context ?? null;
  }

  async getAccessToken(options?: { forceRefresh?: boolean }) {
    if (this.token && !options?.forceRefresh) return this.token;
    if (options?.forceRefresh) {
      this.token = null;
      this.writeStoredToken(null);
    }
    const response = await this.transport.request<{ token: string | null }>(
      { type: "cohub.work.token", forceRefresh: Boolean(options?.forceRefresh) },
      { timeoutMs: 20_000 },
    );
    this.token = response?.token ?? null;
    this.writeStoredToken(this.token);
    return this.token;
  }

  async requestAuthorization(input: { scopes: Permission[]; reason?: string }) {
    const response = await this.transport.request<{ token: string | null }>(
      { type: "cohub.work.authorize", scopes: input.scopes, reason: input.reason },
      { timeoutMs: 120_000 },
    );
    this.token = response?.token ?? null;
    this.writeStoredToken(this.token);
    return Boolean(this.token);
  }

  async purchase(input: { productKey: string }) {
    const response = await this.transport.request<{ checkout: { providerKey: string | null; checkoutUrl: string | null; checkoutUsable: boolean; status: string | null; message: string | null; orderId: string; productKey: string } | null }>(
      { type: "cohub.work.purchase", productKey: input.productKey },
      { timeoutMs: 120_000 },
    );
    return response?.checkout ?? null;
  }

  async checkoutState() {
    const response = await this.transport.request<WorkRuntimeCheckoutState>(
      { type: "cohub.work.checkout-state" },
      { timeoutMs: 8_000, retryIntervalMs: 250 },
    );
    return response ?? null;
  }
}

/**
 * Configuration for the work runtime mode.
 */
export type WorkRuntimeModeConfig = {
  /** Explicit mode selection. When omitted, auto-detection is used. */
  mode?: "bridge" | "broker";
  /** Cohub origin for the broker page (e.g. "https://cohub.run"). */
  brokerOrigin?: string;
  /** The work's public id. Required for broker mode. */
  workId?: string;
};

/**
 * Resolves the appropriate transport based on the work mode configuration.
 * Auto-detection: inside an iframe → bridge; standalone with broker config →
 * broker; otherwise → bridge (returns null for non-work contexts).
 */
export function resolveWorkTransport(
  config?: WorkRuntimeModeConfig,
): WorkRuntimeTransport {
  const explicitMode = config?.mode;
  const brokerOrigin = config?.brokerOrigin;
  const workId = config?.workId;
  const hasBrokerConfig = Boolean(brokerOrigin && workId);

  const createBroker = (): WorkRuntimeTransport =>
    brokerOrigin && workId
      ? new PopupBrokerTransport({ brokerOrigin, workId })
      : new ParentBridgeTransport();

  if (explicitMode === "bridge") return new ParentBridgeTransport();
  if (explicitMode === "broker") return createBroker();

  // Auto-detect
  if (typeof window !== "undefined" && window.parent !== window) {
    // Inside an iframe → bridge mode
    return new ParentBridgeTransport();
  }
  // Standalone: use broker if configured, otherwise fall back to bridge
  // (which returns null when there is no parent — the SDK simply isn't in a
  // work runtime context).
  return hasBrokerConfig ? createBroker() : new ParentBridgeTransport();
}

export const createWorkRuntime = (
  transport?: WorkRuntimeTransport,
  workId?: string,
) => new WorkRuntimeApi(transport, workId);
