import type { Fetch } from "../transport.js";
import type { ModelCatalogEntry } from "../types.js";

export class ModelsApi {
  constructor(private readonly fetcher: Fetch, private readonly baseUrl: string) {}

  async list(customFetch?: Fetch) {
    const fetchImpl = customFetch ?? this.fetcher;
    const url = this.baseUrl ? `${this.baseUrl}/api/models` : "/api/models";
    const response = await fetchImpl(url);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch models: ${response.status} ${response.statusText}`,
      );
    }
    return response.json() as Promise<Record<string, ModelCatalogEntry[]>>;
  }
}
