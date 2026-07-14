import type { HttpTransport, Fetch } from "../transport.js";
import type { SkillCatalogResponse } from "../types.js";

export class SkillsApi {
  constructor(private readonly transport: HttpTransport) {}

  async list(options?: { spaceId?: string }, customFetch?: Fetch) {
    const params = new URLSearchParams();
    if (options?.spaceId) params.set("spaceId", options.spaceId);
    const query = params.toString();
    const path = query ? `/api/skills?${query}` : "/api/skills";
    return this.transport.request<SkillCatalogResponse>(path, {
      fetch: customFetch,
    });
  }
}
