import { existsSync, readFileSync } from "node:fs";
import type { Api, Model } from "@mariozechner/pi-ai";
import { getAgentPlatformModelsPath, getAgentUserModelsPath } from "./paths.js";

type ModelCompat = Model<Api>["compat"];

type ModelCost = {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
};

type ModelDef = {
  id: string;
  name?: string;
  api?: string;
  baseUrl?: string;
  reasoning?: boolean;
  input?: Array<"text" | "image">;
  cost?: ModelCost;
  contextWindow?: number;
  maxTokens?: number;
  headers?: Record<string, string>;
  compat?: ModelCompat;
};

type ProviderConfig = {
  baseUrl?: string;
  apiKey?: string;
  api?: string;
  headers?: Record<string, string>;
  compat?: ModelCompat;
  models?: ModelDef[];
};

type ModelsConfig = {
  providers: Record<string, ProviderConfig>;
};

function isModelsConfig(value: unknown): value is ModelsConfig {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return !!record.providers && typeof record.providers === "object";
}

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
  private readonly userId?: string | null;

  constructor(input?: { userId?: string | null }) {
    this.userId = input?.userId ?? null;
    this.refresh();
  }

  refresh(): void {
    this.models = [];
    this.providerApiKeys.clear();
    this.providerHeaders.clear();
    this.loadError = undefined;

    const modelsPaths = [
      getAgentPlatformModelsPath(),
      ...(this.userId ? [getAgentUserModelsPath(this.userId)] : []),
    ];

    const mergedModels = new Map<string, Model<Api>>();
    const errors: string[] = [];

    for (const modelsPath of modelsPaths) {
      if (!existsSync(modelsPath)) {
        continue;
      }

      try {
        const content = readFileSync(modelsPath, "utf-8");
        const parsedUnknown = JSON.parse(content) as unknown;
        if (!isModelsConfig(parsedUnknown)) {
          errors.push(`Invalid models.json schema: missing providers object\n\nFile: ${modelsPath}`);
          continue;
        }

        for (const [provider, providerConfig] of Object.entries(parsedUnknown.providers)) {
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
              compat: modelDef.compat ?? providerConfig.compat,
            } as Model<Api>);
          }
        }
      } catch (error) {
        errors.push(`Failed to load models.json: ${error instanceof Error ? error.message : String(error)}\n\nFile: ${modelsPath}`);
      }
    }

    this.models = [...mergedModels.values()];
    if (errors.length > 0) {
      this.loadError = errors.join("\n\n");
    }
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

export function getPlatformModelsPath(): string {
  return getAgentPlatformModelsPath();
}
