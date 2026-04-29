import type { CohubEnvironment } from "./environment.js";
import { resolveApiBaseUrl } from "./environment.js";
import type { WebsocketClientOptions } from "./websocket.js";

export type Fetch = typeof globalThis.fetch;

export type CohubClientOptions = {
  env?: CohubEnvironment;
  baseUrl?: string;
  getAccessToken?: () => Promise<string | null> | string | null;
  onUnauthorized?: () => Promise<void> | void;
  setStoredAuthToken?: (token: string) => void;
  clearStoredAuthToken?: () => void;
  fetch?: Fetch;
  websocket?: WebsocketClientOptions;
};

export class HttpError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

export class HttpTransport {
  private readonly baseUrl: string;
  private readonly fetcher: Fetch;
  private readonly getAccessToken?: () => Promise<string | null> | string | null;
  private readonly onUnauthorized?: () => Promise<void> | void;

  constructor(options: CohubClientOptions = {}) {
    this.baseUrl = resolveApiBaseUrl(options);
    this.fetcher = options.fetch ?? fetch;
    this.getAccessToken = options.getAccessToken;
    this.onUnauthorized = options.onUnauthorized;
  }

  private async withAuthorization(init?: RequestInit): Promise<RequestInit> {
    const headers = new Headers(init?.headers);
    const token = this.getAccessToken ? await this.getAccessToken() : null;

    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    } else {
      headers.delete("Authorization");
    }

    return {
      ...init,
      headers,
    };
  }

  async request<T>(path: string, init?: RequestInit & { fetch?: Fetch }) {
    const fetcher = init?.fetch ?? this.fetcher;
    const url = this.baseUrl ? `${this.baseUrl}${path}` : path;
    const response = await fetcher(url, await this.withAuthorization(init));

    if (response.status === 401) {
      await this.onUnauthorized?.();
      throw new HttpError("unauthorized", 401, null);
    }

    if (!response.ok) {
      const contentType = response.headers.get("content-type") ?? "";
      const body = contentType.includes("application/json")
        ? await response.json().catch(() => null)
        : await response.text().catch(() => response.statusText);
      const message =
        typeof body === "string" ? body : JSON.stringify(body ?? null);
      throw new HttpError(message || response.statusText, response.status, body);
    }

    if (response.status === 204) {
      return null as T;
    }

    return response.json() as Promise<T>;
  }
}
