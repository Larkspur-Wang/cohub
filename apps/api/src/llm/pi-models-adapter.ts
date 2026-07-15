import {
  createModels,
  createProvider,
  type Api,
  type Model,
  type Models,
  type ProviderStreams,
  type SimpleStreamOptions,
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

/** Auth + catalog surface shared by completion registries. */
export type PiModelAuthSource = {
  getAvailable(): Array<Model<Api>>;
  getApiKey(provider: string): string | undefined;
  getHeaders(provider: string, modelId?: string): Record<string, string> | undefined;
};

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
 * Build a pi-ai Models collection around a Cohub completion registry.
 * Auth resolves through the registry; request options may still override apiKey/headers.
 */
export function createModelsFromRegistry(
  registry: PiModelAuthSource,
  focusModel?: Model<Api>,
): Models {
  const models = createModels();
  const available = registry.getAvailable();
  const byProvider = new Map<string, Model<Api>[]>();

  for (const model of available) {
    const list = byProvider.get(model.provider) ?? [];
    list.push(model);
    byProvider.set(model.provider, list);
  }

  if (focusModel && !byProvider.has(focusModel.provider)) {
    byProvider.set(focusModel.provider, [focusModel]);
  } else if (focusModel) {
    const list = byProvider.get(focusModel.provider) ?? [];
    if (!list.some((item) => item.id === focusModel.id)) {
      list.push(focusModel);
      byProvider.set(focusModel.provider, list);
    }
  }

  for (const [providerId, catalog] of byProvider) {
    const apiMap: Partial<Record<Api, ProviderStreams>> = {};
    for (const model of catalog) {
      const streams = API_STREAMS[model.api];
      if (streams) apiMap[model.api] = streams;
    }
    if (Object.keys(apiMap).length === 0) continue;

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
  }

  return models;
}

export function streamSimpleWithModels(
  models: Models,
  model: Model<Api>,
  context: Parameters<Models["streamSimple"]>[1],
  options?: SimpleStreamOptions,
) {
  return models.streamSimple(model, context, options);
}
