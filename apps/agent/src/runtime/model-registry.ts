import type { Api, Model } from "@mariozechner/pi-ai";
import { mergeModelsConfigs, type ModelsConfig } from "@cohub/config-runtime/models";

function resolveApiKey(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const envValue = process.env[value];
  return envValue && envValue.trim().length > 0 ? envValue.trim() : value;
}

export class CohubModelRegistry {
  private models: Model<Api>[] = [];
  private providerApiKeys = new Map<string, string>();
  private providerHeaders = new Map<string, Record<string, string>>();
  private loadError: string | undefined;
  private readonly configs: ModelsConfig[];

  constructor(input?: { configs?: Array<ModelsConfig | null | undefined> }) {
    this.configs = input?.configs?.filter((item): item is ModelsConfig => Boolean(item)) ?? [];
    this.refresh();
  }

  refresh(): void {
    this.models = [];
    this.providerApiKeys.clear();
    this.providerHeaders.clear();
    this.loadError = undefined;

    const mergedConfig = mergeModelsConfigs(...this.configs);
    const mergedModels = new Map<string, Model<Api>>();

    for (const [provider, providerConfig] of Object.entries(mergedConfig.providers)) {
      const apiKey = resolveApiKey(providerConfig.apiKey);
      if (apiKey) this.providerApiKeys.set(provider, apiKey);
      if (providerConfig.headers) this.providerHeaders.set(provider, providerConfig.headers);

      for (const modelDef of providerConfig.models ?? []) {
        const api = modelDef.api ?? providerConfig.api;
        const baseUrl = modelDef.baseUrl ?? providerConfig.baseUrl;
        if (!api || !baseUrl || !modelDef.id) continue;
        mergedModels.set(`${provider}:${modelDef.id}`, {
          id: modelDef.id,
          name: modelDef.name ?? modelDef.id,
          api: api as Api,
          provider,
          baseUrl,
          reasoning: modelDef.reasoning ?? false,
          input: modelDef.input ?? ["text"],
          cost: modelDef.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: modelDef.contextWindow ?? 128000,
          maxTokens: modelDef.maxTokens ?? 16384,
          headers: modelDef.headers,
          compat: (modelDef.compat ?? providerConfig.compat) as Model<Api>["compat"],
        } as Model<Api>);
      }
    }

    this.models = [...mergedModels.values()];
  }

  getAvailable(): Model<Api>[] {
    return [...this.models];
  }

  find(provider: string, id: string): Model<Api> | undefined {
    return this.models.find((model) => model.provider === provider && model.id === id);
  }

  getDefault(): Model<Api> | undefined {
    return this.models[0];
  }

  getError(): string | undefined {
    return this.loadError;
  }

  getApiKey(provider: string): string | undefined {
    return this.providerApiKeys.get(provider);
  }

  getHeaders(provider: string, modelId?: string): Record<string, string> | undefined {
    const model = modelId ? this.find(provider, modelId) : undefined;
    return model?.headers ?? this.providerHeaders.get(provider);
  }
}
