import type { HttpTransport } from "../transport.js";
import type { SpaceAccessPolicy, SpaceRole } from "../types.js";

export class SessionAccessApi {
  constructor(private readonly transport: HttpTransport) {}

  get(sessionId: string) {
    return this.transport.request<SpaceAccessPolicy>(
      `/api/sessions/${sessionId}/access`,
    );
  }

  set(sessionId: string, body: { anonymous_user?: SpaceRole | null }) {
    return this.transport.request<SpaceAccessPolicy>(
      `/api/sessions/${sessionId}/access`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
  }

  remove(sessionId: string) {
    return this.transport.request<{ ok: true }>(
      `/api/sessions/${sessionId}/access`,
      { method: "DELETE" },
    );
  }
}
