import type { Api, Model, ProviderHeaders, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { mergeHeaders, type ModelRequestProfile } from "@cohub/infra/config-runtime/models";

export type ProfiledModel = Model<Api> & { requestProfile?: ModelRequestProfile };

export function applyRequestProfile(model: ProfiledModel, options: SimpleStreamOptions): SimpleStreamOptions {
  if (model.requestProfile !== "codex" || !options.sessionId) return options;

  const requestId = options.sessionId.slice(0, 64);
  const affinityHeaders: ProviderHeaders = {
    "session-id": requestId,
    "thread-id": requestId,
  };
  return { ...options, headers: mergeHeaders(affinityHeaders, options.headers) };
}
