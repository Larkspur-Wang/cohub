import type { Api, Model, Models } from "@earendil-works/pi-ai";
import {
  createModelsFromRegistry,
  type PiModelAuthSource,
} from "@cohub/model-runtime/pi-models-adapter";
import type { CohubModelRegistry } from "./model-registry.js";

export {
  createModelsFromRegistry,
  streamSimpleWithModels,
  type PiModelAuthSource,
} from "@cohub/model-runtime/pi-models-adapter";

export function createModelsFromCohubRegistry(
  registry: CohubModelRegistry,
  focusModel?: Model<Api>,
): Models {
  return createModelsFromRegistry(registry as PiModelAuthSource, focusModel);
}
