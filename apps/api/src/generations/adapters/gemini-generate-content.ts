import type { GenerationContentBlock } from "@cohub/protocol/generation";
import { resolveDeclarationApiKey } from "../declarations.js";
import { GenerationProviderError } from "../errors.js";
import { resolveSourceAsUrlOrDataUri } from "../sources.js";
import { mergeTextBlocks } from "../validation.js";
import type { GenerationAdapterInput } from "./index.js";

const REQUEST_TIMEOUT_MS = 300_000;
const IMAGE_FETCH_TIMEOUT_MS = 60_000;
const MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024;

const DATA_URI_PATTERN = /^data:([^;]+);base64,(.+)$/s;
const MARKDOWN_IMAGE_DATA_URI_PATTERN = /!\[[^\]]*\]\(data:([^;]+);base64,([^)]+)\)/;

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

type GeminiResponsePart = {
  text?: unknown;
  inlineData?: {
    mimeType?: unknown;
    data?: unknown;
  };
  inline_data?: {
    mime_type?: unknown;
    mimeType?: unknown;
    data?: unknown;
  };
};

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: GeminiResponsePart[];
    };
  }>;
};

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function dataUriToInlineData(value: string): GeminiPart | null {
  const match = DATA_URI_PATTERN.exec(value);
  if (!match) return null;
  const [, mimeType, data] = match;
  if (!mimeType || !data) return null;
  return { inlineData: { mimeType, data } };
}

async function urlToInlineData(url: string): Promise<GeminiPart> {
  const response = await fetchWithTimeout(url, {
    method: "GET",
    headers: { "User-Agent": "Cohub/1.0" },
  }, IMAGE_FETCH_TIMEOUT_MS);

  if (!response.ok) throw new GenerationProviderError();

  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error("Reference image is too large");
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_REFERENCE_IMAGE_BYTES) throw new Error("Reference image is too large");

  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim();
  const mimeType = contentType?.startsWith("image/") ? contentType : "image/png";
  return { inlineData: { mimeType, data: bytes.toString("base64") } };
}

async function sourceToInlineData(value: string): Promise<GeminiPart> {
  const inline = dataUriToInlineData(value);
  if (inline) return inline;
  if (value.startsWith("http://") || value.startsWith("https://")) return urlToInlineData(value);
  throw new Error("Unsupported image source for Gemini image generation");
}

function extractMarkdownDataUriImage(text: string): GenerationContentBlock | null {
  const match = MARKDOWN_IMAGE_DATA_URI_PATTERN.exec(text);
  if (!match) return null;
  const [, mediaType, data] = match;
  if (!mediaType || !data) return null;
  return { type: "image", source: { type: "base64", media_type: mediaType, data } };
}

function appendGeminiPartOutput(output: GenerationContentBlock[], part: GeminiResponsePart): void {
  if (typeof part.text === "string" && part.text.trim()) {
    const image = extractMarkdownDataUriImage(part.text);
    if (image) {
      output.push(image);
      return;
    }
    output.push({ type: "text", text: part.text });
    return;
  }

  if (part.inlineData && typeof part.inlineData.data === "string" && part.inlineData.data) {
    output.push({
      type: "image",
      source: {
        type: "base64",
        media_type: typeof part.inlineData.mimeType === "string" ? part.inlineData.mimeType : "image/png",
        data: part.inlineData.data,
      },
    });
    return;
  }

  const inline = part.inline_data;
  if (!inline || typeof inline.data !== "string" || !inline.data) return;

  const mediaType = typeof inline.mime_type === "string"
    ? inline.mime_type
    : typeof inline.mimeType === "string"
      ? inline.mimeType
      : "image/png";

  output.push({
    type: "image",
    source: { type: "base64", media_type: mediaType, data: inline.data },
  });
}

export async function geminiGenerateContentAdapter(input: GenerationAdapterInput): Promise<GenerationContentBlock[]> {
  const prompt = mergeTextBlocks(input.declaration, input.request.content);
  if (!prompt) throw new Error("Prompt text is required");

  const imageParts = await Promise.all(
    input.request.content
      .filter((block): block is Extract<GenerationContentBlock, { type: "image" }> => block.type === "image")
      .map(async (block) => sourceToInlineData(await resolveSourceAsUrlOrDataUri(block.source, input.user))),
  );

  const generationConfig: Record<string, unknown> = {
    responseModalities: ["IMAGE"],
  };

  const aspectRatio = input.parameters.aspect_ratio;
  const imageSize = input.parameters.image_size;
  if (typeof aspectRatio === "string" || typeof imageSize === "string") {
    const image: Record<string, string> = {};
    if (typeof aspectRatio === "string") image.aspectRatio = aspectRatio;
    if (typeof imageSize === "string") image.imageSize = imageSize;
    generationConfig.responseFormat = { image };
  }

  const payload = {
    contents: [{ parts: [{ text: prompt }, ...imageParts] satisfies GeminiPart[] }],
    generationConfig,
  };

  const url = `${input.declaration.adapter.base_url.replace(/\/$/, "")}/models/${encodeURIComponent(input.declaration.model)}:generateContent`;
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resolveDeclarationApiKey(input.declaration.adapter.api_key)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  }, REQUEST_TIMEOUT_MS);

  if (!response.ok) {
    const body = await response.text().catch(() => response.statusText);
    console.warn("[generations] gemini.generateContent request failed", {
      status: response.status,
      model: input.declaration.model,
      body,
    });
    throw new GenerationProviderError();
  }

  const raw = await response.json() as GeminiGenerateContentResponse;
  const output: GenerationContentBlock[] = [];
  for (const candidate of raw.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) appendGeminiPartOutput(output, part);
  }

  if (output.length === 0) throw new GenerationProviderError();
  return output;
}
