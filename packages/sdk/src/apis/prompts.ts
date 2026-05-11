import type { HttpTransport, Fetch } from "../transport.js";
import type { PromptTemplateCatalogResponse } from "../types.js";

export class PromptsApi {
  constructor(private readonly transport: HttpTransport) {}

  async list(options?: { spaceId?: string }, customFetch?: Fetch) {
    const params = new URLSearchParams();
    if (options?.spaceId) params.set("spaceId", options.spaceId);
    const query = params.toString();
    const path = query ? `/api/prompts?${query}` : "/api/prompts";
    return this.transport.request<PromptTemplateCatalogResponse>(path, {
      fetch: customFetch,
    });
  }
}
