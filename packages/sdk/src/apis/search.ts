import type { Fetch, HttpTransport } from "../transport.js";
import type { GlobalSearchResponse, GlobalSearchType } from "../types.js";

export class SearchApi {
  constructor(private readonly transport: HttpTransport) {}

  query(input: { q: string; limit?: number; types?: GlobalSearchType[]; spaceId?: string }, customFetch?: Fetch) {
    const params = new URLSearchParams({ q: input.q });
    if (input.limit !== undefined) params.set("limit", String(input.limit));
    for (const type of input.types ?? []) params.append("type", type);
    if (input.spaceId) params.set("spaceId", input.spaceId);
    return this.transport.request<GlobalSearchResponse>(`/api/search?${params.toString()}`, {
      fetch: customFetch,
    });
  }
}
