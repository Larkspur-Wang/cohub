import type { HttpTransport, Fetch } from "../transport.js";
import type { Channel } from "../types.js";

export class ChannelsApi {
  constructor(private readonly transport: HttpTransport) {}

  list(customFetch?: Fetch) {
    return this.transport.request<Channel[]>("/api/channels", {
      method: "GET",
      fetch: customFetch,
    });
  }

  create(data: {
    provider: string;
    name: string;
    credentials: Record<string, unknown>;
  }) {
    return this.transport.request("/api/channels", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
  }

  startWeChatLogin(data: { name?: string }) {
    return this.transport.request<{
      sessionKey: string;
      qrDataUrl: string;
      message: string;
      expiresInSeconds: number;
    }>("/api/channels/wechat/login/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
  }

  waitWeChatLogin(data: { sessionKey: string }) {
    return this.transport.request<{
      connected: boolean;
      expired?: boolean;
      status?: string;
      message: string;
      channel?: Channel;
    }>("/api/channels/wechat/login/wait", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
  }

  delete(id: string) {
    return this.transport.request(`/api/channels/${id}`, { method: "DELETE" });
  }
}
