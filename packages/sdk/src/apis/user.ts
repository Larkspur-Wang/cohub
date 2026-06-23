import { HttpError, type HttpTransport, type Fetch } from "../transport.js";
import type { MeResponse, UserProfile, UserRulesResponse, SpaceSessionsResponse, SpaceUsageResponse } from "../types.js";

export class UserApi {
  constructor(
    private readonly transport: HttpTransport,
    private readonly transportBaseUrl: string,
    private readonly setStoredAuthToken?: (token: string) => void,
    private readonly clearStoredAuthToken?: () => void,
  ) {}

  getMe(customFetch?: Fetch) {
    return this.transport.request<MeResponse>("/api/me", { fetch: customFetch });
  }

  updateProfile(input: { displayName?: string; avatarUrl?: string | null; username?: string | null }) {
    return this.transport.request<{ profile: UserProfile }>("/api/me/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  }

  getRules(customFetch?: Fetch) {
    return this.transport.request<UserRulesResponse>("/api/me/rules", {
      method: "GET",
      fetch: customFetch,
    });
  }

  listSessions(optionsOrFetch?: { limit?: number; cursor?: string | null } | Fetch, customFetch?: Fetch) {
    const options = typeof optionsOrFetch === "function" ? undefined : optionsOrFetch;
    const fetch = typeof optionsOrFetch === "function" ? optionsOrFetch : customFetch;
    const params = new URLSearchParams();
    if (options?.limit !== undefined) params.set("limit", String(options.limit));
    if (options?.cursor) params.set("cursor", options.cursor);
    const query = params.toString();
    return this.transport.request<SpaceSessionsResponse>(
      `/api/me/sessions${query ? `?${query}` : ""}`,
      { fetch },
    );
  }

  getUsage(days = 30, customFetch?: Fetch) {
    const params = new URLSearchParams({ days: String(days) });
    return this.transport.request<SpaceUsageResponse>(
      `/api/me/usage?${params.toString()}`,
      { fetch: customFetch },
    );
  }

  async setAuthToken(token: string) {
    const trimmedToken = token.trim();
    const response = await fetch(
      this.transportBaseUrl ? `${this.transportBaseUrl}/api/me` : "/api/me",
      {
        headers: {
          Authorization: `Bearer ${trimmedToken}`,
        },
      },
    );

    if (!response.ok) {
      const contentType = response.headers.get("content-type") ?? "";
      const body = contentType.includes("application/json")
        ? await response.json().catch(() => null)
        : await response.text().catch(() => response.statusText);
      const message =
        typeof body === "string" ? body : JSON.stringify(body ?? null);
      throw new HttpError(message || response.statusText, response.status, body);
    }

    this.setStoredAuthToken?.(trimmedToken);
    return response.json();
  }

  async clearAuthToken() {
    this.clearStoredAuthToken?.();
    return null;
  }
}
