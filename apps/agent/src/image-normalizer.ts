import { createHash } from "node:crypto";
import sharp from "sharp";
import type { ContentBlock } from "@cohub/protocol/core";
import type { ImageContent } from "@earendil-works/pi-ai";
import { logger } from "./logger.js";

export const AGENT_IMAGE_MAX_EDGE = 1984;
export const AGENT_IMAGE_WEBP_QUALITY = 86;
export const AGENT_IMAGE_MAX_INPUT_BYTES = 32 * 1024 * 1024;
export const AGENT_IMAGE_MAX_INPUT_PIXELS = 64_000_000;

const IMAGE_NORMALIZE_CONCURRENCY = 2;
const OUTPUT_MIME_TYPE = "image/webp";
const BASE64_PREFIX_PATTERN = /^data:[^;,]+;base64,/;
const BASE64_INPUT_MAX_CHARS = Math.ceil(AGENT_IMAGE_MAX_INPUT_BYTES / 3) * 4 + 64;

type ImageSourceKind = "user_message" | "tool_result" | "public_asset";

type NormalizeImageInput = {
  data: Buffer;
  mimeType?: string | null;
  sourceKind: ImageSourceKind;
  label?: string;
  originalSource?: "base64" | "url" | "file";
  originalUrl?: string;
};

type ReadUrlImage = (url: string) => Promise<{ data: Buffer; mimeType: string } | null>;

type NormalizedImage = {
  data: string;
  mimeType: typeof OUTPUT_MIME_TYPE;
  meta: Record<string, unknown>;
};

function imageSha256(data: Buffer) {
  return createHash("sha256").update(data).digest("hex");
}

function normalizeBase64Data(data: string) {
  return data.replace(BASE64_PREFIX_PATTERN, "");
}

export function imageOmittedText(reason: string, label?: string) {
  return label ? `Image omitted (${label}): ${reason}.` : `Image omitted: ${reason}.`;
}

function getImageMeta(input: NormalizeImageInput, normalized: { data: Buffer; width?: number; height?: number }) {
  return {
    imageNormalized: true,
    imageFormat: "webp",
    originalMimeType: input.mimeType ?? null,
    originalSource: input.originalSource ?? null,
    originalUrl: input.originalUrl ?? null,
    originalSizeBytes: input.data.byteLength,
    originalSha256: imageSha256(input.data),
    normalizedSizeBytes: normalized.data.byteLength,
    normalizedWidth: normalized.width ?? null,
    normalizedHeight: normalized.height ?? null,
    normalizedMaxEdge: AGENT_IMAGE_MAX_EDGE,
    normalizedQuality: AGENT_IMAGE_WEBP_QUALITY,
  };
}

export async function normalizeAgentImage(input: NormalizeImageInput): Promise<NormalizedImage | null> {
  if (input.data.byteLength === 0) return null;
  if (input.data.byteLength > AGENT_IMAGE_MAX_INPUT_BYTES) {
    logger.warn(`[AgentImage] skip oversized image source=${input.sourceKind} size=${input.data.byteLength}`);
    return null;
  }

  try {
    const transformer = sharp(input.data, { animated: false, limitInputPixels: AGENT_IMAGE_MAX_INPUT_PIXELS }).rotate();
    const metadata = await transformer.metadata();
    const output = await transformer
      .resize(AGENT_IMAGE_MAX_EDGE, AGENT_IMAGE_MAX_EDGE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: AGENT_IMAGE_WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });

    return {
      data: output.data.toString("base64"),
      mimeType: OUTPUT_MIME_TYPE,
      meta: {
        ...getImageMeta(input, { data: output.data, width: output.info.width, height: output.info.height }),
        originalWidth: metadata.width ?? null,
        originalHeight: metadata.height ?? null,
      },
    };
  } catch (error) {
    logger.warn(`[AgentImage] failed to normalize image source=${input.sourceKind} label=${input.label ?? "unknown"}:`, error);
    return null;
  }
}

export async function normalizeImageContentBlock(block: Extract<ContentBlock, { type: "image" }>, options?: { readUrlImage?: ReadUrlImage }): Promise<ContentBlock> {
  if (block.source.type === "url") {
    const publicAsset = await options?.readUrlImage?.(block.source.url).catch(() => null);
    if (!publicAsset) {
      return {
        type: "text",
        text: imageOmittedText("image could not be loaded"),
        _meta: {
          ...(block._meta ?? {}),
          imageNormalizationFailed: true,
          reason: "load_failed",
          originalSource: "url",
          originalUrl: block.source.url,
        },
      };
    }

    const normalized = await normalizeAgentImage({
      data: publicAsset.data,
      mimeType: publicAsset.mimeType,
      sourceKind: "public_asset",
      originalSource: "url",
      originalUrl: block.source.url,
    });

    if (!normalized) {
      return {
        type: "text",
        text: imageOmittedText("image could not be processed"),
        _meta: {
          ...(block._meta ?? {}),
          imageNormalizationFailed: true,
          reason: "decode_failed",
          originalMimeType: publicAsset.mimeType,
          originalSource: "url",
          originalUrl: block.source.url,
        },
      };
    }

    return {
      type: "image",
      source: {
        type: "base64",
        media_type: normalized.mimeType,
        data: normalized.data,
      },
      _meta: {
        ...(block._meta ?? {}),
        ...normalized.meta,
      },
    };
  }

  if (block._meta?.imageNormalized === true && block.source.media_type === OUTPUT_MIME_TYPE) return block;

  const data = normalizeBase64Data(block.source.data);
  if (data.length > BASE64_INPUT_MAX_CHARS) {
    return {
      type: "text",
      text: imageOmittedText("image is too large to process"),
      _meta: {
        ...(block._meta ?? {}),
        imageNormalizationFailed: true,
        reason: "too_large",
        originalMimeType: block.source.media_type,
      },
    };
  }

  const normalized = await normalizeAgentImage({
    data: Buffer.from(data, "base64"),
    mimeType: block.source.media_type,
    sourceKind: "user_message",
    originalSource: "base64",
  });

  if (!normalized) {
    return {
      type: "text",
      text: imageOmittedText("image could not be processed"),
      _meta: {
        ...(block._meta ?? {}),
        imageNormalizationFailed: true,
        reason: "decode_failed",
        originalMimeType: block.source.media_type,
      },
    };
  }

  return {
    type: "image",
    source: {
      type: "base64",
      media_type: normalized.mimeType,
      data: normalized.data,
    },
    _meta: {
      ...(block._meta ?? {}),
      ...normalized.meta,
    },
  };
}

async function mapWithConcurrency<Item, Result>(items: Item[], concurrency: number, mapper: (item: Item) => Promise<Result>): Promise<Result[]> {
  const results = new Array<Result>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const itemIndex = nextIndex;
      nextIndex += 1;
      const item = items[itemIndex];
      if (item === undefined) return;
      results[itemIndex] = await mapper(item);
    }
  }));
  return results;
}

export async function normalizeContentBlocksImages(content: ContentBlock[], options?: { readUrlImage?: ReadUrlImage }): Promise<ContentBlock[]> {
  return mapWithConcurrency(content, IMAGE_NORMALIZE_CONCURRENCY, (block) => block.type === "image" ? normalizeImageContentBlock(block, options) : Promise.resolve(block));
}

export async function normalizeAgentToolImageContent(input: { data: Buffer; mimeType: string; label?: string }): Promise<ImageContent | { type: "text"; text: string }> {
  const normalized = await normalizeAgentImage({
    data: input.data,
    mimeType: input.mimeType,
    sourceKind: "tool_result",
    label: input.label,
    originalSource: "file",
  });
  if (!normalized) return { type: "text", text: imageOmittedText("image could not be processed", input.label) };
  return { type: "image", data: normalized.data, mimeType: normalized.mimeType };
}
