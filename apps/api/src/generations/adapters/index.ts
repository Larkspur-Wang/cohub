import type { CreateGenerationRequest, GenerationContentBlock, GenerationDeclaration } from "@cohub/protocol/generation";
import type { AuthUser } from "../../lib/middleware.js";
import { openAiImagesAdapter } from "./openai-images.js";

export type GenerationAdapterInput = {
  declaration: GenerationDeclaration;
  user: AuthUser;
  request: CreateGenerationRequest;
  parameters: Record<string, unknown>;
};

export type GenerationAdapter = (input: GenerationAdapterInput) => Promise<GenerationContentBlock[]>;

const adapters: Record<string, GenerationAdapter> = {
  "openai.images": openAiImagesAdapter,
};

export function getGenerationAdapter(type: string): GenerationAdapter {
  const adapter = adapters[type];
  if (!adapter) throw new Error(`Unsupported generation adapter: ${type}`);
  return adapter;
}
