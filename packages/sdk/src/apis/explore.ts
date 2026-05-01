import type { ExploreSpaceItem } from "../types.js";
import type { HttpTransport } from "../transport.js";

export class ExploreApi {
  constructor(private readonly transport: HttpTransport) {}

  spaces() {
    return this.transport.request<{ spaces: ExploreSpaceItem[] }>(
      "/api/explore/spaces",
    );
  }
}
