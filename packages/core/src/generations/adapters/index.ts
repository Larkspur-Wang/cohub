import type {
  CreateGenerationTaskRequest,
  GenerationContentBlock,
  GenerationDeclaration,
  GenerationSource,
} from "@cohub/protocol/generation";
import { arkVideoGenerationsAdapter } from "./ark-video-generations.js";
import { geminiGenerateContentAdapter } from "./gemini-generate-content.js";
import { openAiImagesAdapter } from "./openai-images.js";

export type GenerationUserContext = {
  uuid: string;
};

export type GenerationSourceResolver = (
  source: GenerationSource,
  user: GenerationUserContext,
) => Promise<string>;

export type GenerationAdapterInput = {
  declaration: GenerationDeclaration;
  user: GenerationUserContext;
  request: CreateGenerationTaskRequest;
  parameters: Record<string, unknown>;
  resolveSource: GenerationSourceResolver;
};

export type GenerationAdapter = (input: GenerationAdapterInput) => Promise<GenerationContentBlock[]>;

const adapters: Record<string, GenerationAdapter> = {
  "ark.videoGenerations": arkVideoGenerationsAdapter,
  "gemini.generateContent": geminiGenerateContentAdapter,
  "openai.images": openAiImagesAdapter,
};

export function getGenerationAdapter(type: string): GenerationAdapter {
  const adapter = adapters[type];
  if (!adapter) throw new Error(`Unsupported generation adapter: ${type}`);
  return adapter;
}
