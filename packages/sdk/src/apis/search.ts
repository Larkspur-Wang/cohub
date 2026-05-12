import type { Fetch, HttpTransport } from "../transport.js";
import type { GlobalSearchResponse } from "../types.js";

export class SearchApi {
  constructor(private readonly transport: HttpTransport) {}

  query(input: { q: string; limit?: number }, customFetch?: Fetch) {
    const params = new URLSearchParams({ q: input.q });
    if (input.limit !== undefined) params.set("limit", String(input.limit));
    return this.transport.request<GlobalSearchResponse>(`/api/search?${params.toString()}`, {
      fetch: customFetch,
    });
  }
}
