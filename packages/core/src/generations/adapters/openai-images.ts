import type { GenerationContentBlock } from "@cohub/protocol/generation";
import { resolveDeclarationApiKey } from "../api-key.js";
import { GenerationProviderError } from "../errors.js";
import { mergeTextBlocks } from "../validation.js";
import type { GenerationAdapterInput } from "./index.js";

const REQUEST_TIMEOUT_MS = 300_000;

type OpenAiImagesResponse = {
  data?: Array<{
    url?: unknown;
    revised_prompt?: unknown;
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

export async function openAiImagesAdapter(input: GenerationAdapterInput): Promise<GenerationContentBlock[]> {
  const prompt = mergeTextBlocks(input.declaration, input.request.content);
  if (!prompt) throw new Error("Prompt text is required");

  const images = await Promise.all(
    input.request.content
      .filter((block): block is Extract<GenerationContentBlock, { type: "image" }> => block.type === "image")
      .map((block) => input.resolveSource(block.source, input.user)),
  );

  const payload: Record<string, unknown> = {
    model: input.declaration.model,
    prompt,
    ...input.parameters,
  };
  if (images.length > 0) payload.image = images;

  const url = `${input.declaration.adapter.base_url.replace(/\/$/, "")}/images/generations`;
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
    console.warn("[generations] openai.images request failed", {
      status: response.status,
      model: input.declaration.model,
      body,
    });
    throw new GenerationProviderError("Generation provider request failed", {
      status: response.status,
      body,
    });
  }

  const raw = await response.json() as OpenAiImagesResponse;
  const output: GenerationContentBlock[] = [];
  for (const item of raw.data ?? []) {
    if (typeof item.url === "string" && item.url) {
      output.push({ type: "image", source: { type: "url", url: item.url } });
    }
    if (typeof item.revised_prompt === "string" && item.revised_prompt.trim()) {
      output.push({
        type: "text",
        text: item.revised_prompt,
        _meta: { role: "revised_prompt" },
      });
    }
  }
  return output;
}
