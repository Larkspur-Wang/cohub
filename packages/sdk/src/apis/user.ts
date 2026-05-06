import { HttpError, type HttpTransport, type Fetch } from "../transport.js";
import type { UserRulesResponse, UserSshKey } from "../types.js";

export class UserApi {
  constructor(
    private readonly transport: HttpTransport,
    private readonly transportBaseUrl: string,
    private readonly setStoredAuthToken?: (token: string) => void,
    private readonly clearStoredAuthToken?: () => void,
  ) {}

  getMe(customFetch?: Fetch) {
    return this.transport.request("/api/me", { fetch: customFetch });
  }

  getRules(customFetch?: Fetch) {
    return this.transport.request<UserRulesResponse>("/api/me/rules", {
      method: "GET",
      fetch: customFetch,
    });
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

  getSshKeys(customFetch?: Fetch) {
    return this.transport.request<UserSshKey[]>("/api/user/ssh-keys", {
      method: "GET",
      fetch: customFetch,
    });
  }

  createSshKey(data: { key: string; title: string }) {
    return this.transport.request<UserSshKey>("/api/user/ssh-keys", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
  }

  deleteSshKey(id: string) {
    return this.transport.request<{ ok: true }>(`/api/user/ssh-keys/${id}`, {
      method: "DELETE",
    });
  }
}
