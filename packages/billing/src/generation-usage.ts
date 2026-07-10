import {
  COHUB_BILLING_USAGE_TYPES,
  type CohubBillingUsageType,
} from "./interfaces.js";
import type { BillingUsageKind } from "./usage-gate.js";

/** Strict image adapters — always image generation. */
const IMAGE_ADAPTER_TYPES = new Set([
  "openai.images",
  "openai.imageEdits",
]);

const VIDEO_ADAPTER_TYPES = new Set([
  "ark.videoGenerations",
  "kling.videoGenerations",
]);

const MUSIC_ADAPTER_TYPES = new Set([
  "suno.tasks",
]);

/**
 * Adapters that can host multiple modalities. Prefer content-block types;
 * fall back to a default usage type when content is inconclusive.
 */
const AMBIGUOUS_ADAPTER_DEFAULTS: Record<string, CohubBillingUsageType> = {
  "gemini.generateContent": COHUB_BILLING_USAGE_TYPES.generationImage,
};

function normalizeType(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Extract content block type strings from generation content/output arrays.
 * Shared by API gate and worker billing so modality resolution stays aligned.
 */
export function contentTypesFromBlocks(blocks: Iterable<unknown> | null | undefined): string[] {
  if (!blocks) return [];
  const types: string[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object" || Array.isArray(block)) continue;
    const type = (block as { type?: unknown }).type;
    if (typeof type === "string" && type.trim()) types.push(type.trim());
  }
  return types;
}

function usageTypeFromContentTypes(contentTypes: Iterable<string> | null | undefined): CohubBillingUsageType | null {
  if (!contentTypes) return null;
  let sawImage = false;
  let sawVideo = false;
  let sawAudio = false;
  for (const raw of contentTypes) {
    const type = normalizeType(raw);
    if (type === "image") sawImage = true;
    else if (type === "video") sawVideo = true;
    else if (type === "audio") sawAudio = true;
  }
  // Prefer the highest-cost media family when multiple are present.
  if (sawVideo) return COHUB_BILLING_USAGE_TYPES.generationVideo;
  if (sawAudio) return COHUB_BILLING_USAGE_TYPES.generationMusic;
  if (sawImage) return COHUB_BILLING_USAGE_TYPES.generationImage;
  return null;
}

/**
 * Resolve a multimodal generation ledger usage type.
 *
 * Order:
 * 1. Strict adapter families (image / video / music)
 * 2. Content block modality (for ambiguous adapters / unknown adapters)
 * 3. Ambiguous-adapter default (e.g. gemini → image)
 * 4. Generic `generation`
 */
export function resolveGenerationUsageType(input: {
  adapterType?: string | null;
  contentTypes?: Iterable<string> | null;
} = {}): CohubBillingUsageType {
  const adapterType = normalizeType(input.adapterType);

  if (IMAGE_ADAPTER_TYPES.has(adapterType)) return COHUB_BILLING_USAGE_TYPES.generationImage;
  if (VIDEO_ADAPTER_TYPES.has(adapterType)) return COHUB_BILLING_USAGE_TYPES.generationVideo;
  if (MUSIC_ADAPTER_TYPES.has(adapterType)) return COHUB_BILLING_USAGE_TYPES.generationMusic;

  const fromContent = usageTypeFromContentTypes(input.contentTypes);
  if (fromContent) return fromContent;

  const ambiguousDefault = AMBIGUOUS_ADAPTER_DEFAULTS[adapterType];
  if (ambiguousDefault) return ambiguousDefault;

  return COHUB_BILLING_USAGE_TYPES.generation;
}

/** Map a generation usage type onto the matching usage-gate kind. */
export function generationUsageKind(usageType: CohubBillingUsageType): BillingUsageKind {
  switch (usageType) {
    case COHUB_BILLING_USAGE_TYPES.generationImage:
      return "generation.image";
    case COHUB_BILLING_USAGE_TYPES.generationVideo:
      return "generation.video";
    case COHUB_BILLING_USAGE_TYPES.generationMusic:
      return "generation.music";
    case COHUB_BILLING_USAGE_TYPES.generationLlm:
      return "llm.turn";
    case COHUB_BILLING_USAGE_TYPES.generationLlmRaw:
      return "llm.raw_completion";
    default:
      return "generation";
  }
}

/** Normalize a provider cost into a positive USD amount suitable for recordUsage. */
export function normalizePositiveUsd(amount: number | null | undefined): number {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return 0;
  return Number(amount.toFixed(8));
}
