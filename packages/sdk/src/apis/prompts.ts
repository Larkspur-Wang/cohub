import type { Fetch } from "../transport.js";
import type { PromptTemplateCatalogResponse } from "../types.js";

export class PromptsApi {
  constructor(private readonly fetcher: Fetch, private readonly baseUrl: string) {}

  async list(options?: { spaceId?: string }, customFetch?: Fetch) {
    const fetchImpl = customFetch ?? this.fetcher;
    const params = new URLSearchParams();
    if (options?.spaceId) params.set("spaceId", options.spaceId);
    const query = params.toString();
    const base = this.baseUrl ? `${this.baseUrl}/api/prompts` : "/api/prompts";
    const url = query ? `${base}?${query}` : base;
    const response = await fetchImpl(url);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch prompt templates: ${response.status} ${response.statusText}`,
      );
    }
    return response.json() as Promise<PromptTemplateCatalogResponse>;
  }
}
