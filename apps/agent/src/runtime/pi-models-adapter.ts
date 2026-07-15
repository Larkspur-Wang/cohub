import {
  createModels,
  createProvider,
  type Api,
  type Model,
  type Models,
  type ProviderStreams,
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { azureOpenAIResponsesApi } from "@earendil-works/pi-ai/api/azure-openai-responses.lazy";
import { bedrockConverseStreamApi } from "@earendil-works/pi-ai/api/bedrock-converse-stream.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { googleVertexApi } from "@earendil-works/pi-ai/api/google-vertex.lazy";
import { mistralConversationsApi } from "@earendil-works/pi-ai/api/mistral-conversations.lazy";
import { openAICodexResponsesApi } from "@earendil-works/pi-ai/api/openai-codex-responses.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { piMessagesApi } from "@earendil-works/pi-ai/api/pi-messages.lazy";
import type { CohubModelRegistry } from "./model-registry.js";

/**
 * Lazy API stream implementations keyed by pi model.api.
 * Used to build a thin Models collection around CohubModelRegistry auth.
 */
const API_STREAMS: Partial<Record<Api, ProviderStreams>> = {
  "anthropic-messages": anthropicMessagesApi(),
  "azure-openai-responses": azureOpenAIResponsesApi(),
  "bedrock-converse-stream": bedrockConverseStreamApi(),
  "google-generative-ai": googleGenerativeAIApi(),
  "google-vertex": googleVertexApi(),
  "mistral-conversations": mistralConversationsApi(),
  "openai-codex-responses": openAICodexResponsesApi(),
  "openai-completions": openAICompletionsApi(),
  "openai-responses": openAIResponsesApi(),
  "pi-messages": piMessagesApi(),
};

/**
 * Build a pi-ai Models instance that resolves apiKey/headers from our registry
 * and dispatches streams by model.api. Used by compaction summarization.
 */
export function createModelsFromRegistry(
  registry: CohubModelRegistry,
  focusModel: Model<Api>,
): Models {
  const models = createModels();
  const providerId = focusModel.provider;
  const providerModels = registry
    .getAvailable()
    .filter((model) => model.provider === providerId);
  const catalog = providerModels.length > 0 ? providerModels : [focusModel];

  const apiMap: Partial<Record<Api, ProviderStreams>> = {};
  for (const model of catalog) {
    const streams = API_STREAMS[model.api];
    if (streams) apiMap[model.api] = streams;
  }
  // Ensure the focused model always has a stream implementation when known.
  if (!apiMap[focusModel.api] && API_STREAMS[focusModel.api]) {
    apiMap[focusModel.api] = API_STREAMS[focusModel.api];
  }

  models.setProvider(
    createProvider({
      id: providerId,
      name: providerId,
      models: catalog as readonly Model<Api>[],
      auth: {
        apiKey: {
          name: `${providerId} API key`,
          resolve: async ({ model }) => {
            const apiKey = registry.getApiKey(model.provider);
            if (!apiKey) return undefined;
            const headers = registry.getHeaders(model.provider, model.id);
            return {
              auth: {
                apiKey,
                ...(headers ? { headers } : {}),
              },
              source: "cohub-model-registry",
            };
          },
        },
      },
      api: apiMap,
    }),
  );

  return models;
}
