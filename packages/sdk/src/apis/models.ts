import type { HttpTransport } from "../transport.js";
import type { ModelCatalogEntry } from "../types.js";

export class ModelsApi {
  constructor(private readonly transport: HttpTransport) {}

  async list() {
    return this.transport.request<Record<string, ModelCatalogEntry[]>>(
      "/api/models",
    );
  }
}
