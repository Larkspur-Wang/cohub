import type { HttpTransport } from "../transport.js";
import type { ResourcePermission } from "../types.js";
import type { ResourcePermissionLevel } from "../types.js";

export class SessionPermissionsApi {
  constructor(private readonly transport: HttpTransport) {}

  create(sessionId: string, level: ResourcePermissionLevel) {
    return this.transport.request<ResourcePermission>(
      `/api/sessions/${sessionId}/permissions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level }),
      },
    );
  }

  delete(sessionId: string) {
    return this.transport.request<{ ok: true }>(
      `/api/sessions/${sessionId}/permissions`,
      { method: "DELETE" },
    );
  }
}
