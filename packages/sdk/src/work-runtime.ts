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
    const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
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

export class WorkRuntimeApi {
  private token: string | null = null;
  private readonly transport: WorkRuntimeTransport;

  constructor(transport: WorkRuntimeTransport = new ParentBridgeTransport()) {
    this.transport = transport;
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
    const response = await this.transport.request<{ token: string | null }>(
      { type: "cohub.work.token", forceRefresh: Boolean(options?.forceRefresh) },
      { timeoutMs: 20_000 },
    );
    this.token = response?.token ?? null;
    return this.token;
  }

  async requestAuthorization(input: { scopes: Permission[]; reason?: string }) {
    const response = await this.transport.request<{ token: string | null }>(
      { type: "cohub.work.authorize", scopes: input.scopes, reason: input.reason },
      { timeoutMs: 120_000 },
    );
    this.token = response?.token ?? null;
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

export const createWorkRuntime = (transport?: WorkRuntimeTransport) =>
  new WorkRuntimeApi(transport);
