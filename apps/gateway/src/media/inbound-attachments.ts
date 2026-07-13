import { buildFileReferencesText, buildImageReferencesText } from "@cohub/protocol";
import type { ContentBlock } from "@cohub/protocol/core";
import type { GatewayInboundEvent } from "@cohub/protocol/gateway";
import { buildTraceHeaders } from "@cohub/infra/tracing";
import { createLogger } from "@cohub/infra/logging";
import { gatewayConfig } from "../config.js";
import { readResponseBufferLimited } from "../limited-response.js";
import { detectImageMimeType, imageExtensionFromMimeType, sanitizeFilename } from "./mime.js";
import { safeFetch } from "./safe-fetch.js";

const logger = createLogger({ serviceName: "cohub-gateway" });

export type GatewayImageAttachmentPlan = {
  id: string;
  filename: string | null;
  objectKey: string;
  publicUrl: string;
  uploadMethod: "PUT";
  uploadUrl: string;
  uploadHeaders?: Record<string, string>;
  expiresAt: string;
};

export type GatewayFileAttachmentPlan = {
  id: string;
  name: string;
  relativePath: string;
  objectKey: string;
  uploadUrl: string;
  uploadHeaders?: Record<string, string>;
  expiresAt: string;
};

export type GatewayAttachmentPlanResponse = {
  ok: true;
  spaceId: string;
  sessionId: string;
  userId: string;
  bindingKey: string;
  images: GatewayImageAttachmentPlan[];
  files: { uploadId: string | null; entries: GatewayFileAttachmentPlan[] };
};

export type InboundMediaSource = "qq" | "discord" | "wechat" | "feishu";

export type InboundDownloadedImage = {
  id: string;
  buffer: Buffer;
  mediaType: string;
  filename?: string | null;
  originalUrl?: string | null;
};

export type InboundDownloadedFile = {
  id: string;
  buffer: Buffer;
  mediaType?: string | null;
  name: string;
  relativePath?: string | null;
  originalUrl?: string | null;
};

export type IngestInboundMediaResult = {
  blocks: ContentBlock[];
  /** Per-image block in request order (uploaded image or failure text). Useful for preserving original message order. */
  imageBlocksById: Record<string, ContentBlock>;
  uploadedImageUrls: string[];
  uploadedFilePaths: string[];
  imageFailures: number;
  fileFailures: number;
};

export async function requestGatewayAttachmentPlan(input: {
  event: GatewayInboundEvent;
  images: Array<{ id: string; size: number; mimeType: string; filename?: string | null }>;
  files?: Array<{ id: string; name: string; relativePath?: string | null; size: number; mimeType?: string | null }>;
}) {
  const response = await fetch(`${gatewayConfig.apiBaseUrl}/internal/gateway/attachments/plan`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-worker-secret": gatewayConfig.workerSecret,
      ...buildTraceHeaders({ requestId: input.event.eventId }),
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Gateway attachment plan failed ${response.status}: ${text}`);
  }
  const data = await response.json().catch(() => null) as GatewayAttachmentPlanResponse | null;
  if (!data?.ok) throw new Error("Gateway attachment plan returned an invalid response");
  return data;
}

async function putPlannedAttachment(input: {
  buffer: Buffer;
  mediaType?: string | null;
  uploadUrl: string;
  uploadHeaders?: Record<string, string>;
  label: string;
}) {
  const response = await fetch(input.uploadUrl, {
    method: "PUT",
    headers: {
      ...(input.mediaType ? { "content-type": input.mediaType } : {}),
      ...(input.uploadHeaders ?? {}),
    },
    body: new Uint8Array(input.buffer),
  });
  if (!response.ok) throw new Error(`${input.label} upload failed ${response.status}`);
}

export async function uploadPlannedImageAttachment(input: {
  buffer: Buffer;
  mediaType: string;
  plan: GatewayImageAttachmentPlan;
  source: InboundMediaSource;
  originalUrl?: string | null;
}): Promise<ContentBlock> {
  await putPlannedAttachment({
    buffer: input.buffer,
    mediaType: input.mediaType,
    uploadUrl: input.plan.uploadUrl,
    uploadHeaders: input.plan.uploadHeaders,
    label: "Gateway image attachment",
  });
  return {
    type: "image",
    source: { type: "url", url: input.plan.publicUrl },
    _meta: {
      filename: input.plan.filename,
      mediaType: input.mediaType,
      size: input.buffer.length,
      objectKey: input.plan.objectKey,
      source: input.source,
      originalUrl: input.originalUrl ?? null,
    },
  };
}

export async function uploadPlannedFileAttachments(input: {
  spaceId: string;
  uploadId: string | null;
  files: Array<{ id: string; buffer: Buffer; mediaType: string | null }>;
  plans: GatewayFileAttachmentPlan[];
}) {
  if (!input.uploadId || input.files.length === 0) return [] as string[];
  const plansById = new Map(input.plans.map((plan) => [plan.id, plan]));
  const uploadedIds: string[] = [];
  for (const file of input.files) {
    const plan = plansById.get(file.id);
    if (!plan) continue;
    await putPlannedAttachment({
      buffer: file.buffer,
      mediaType: file.mediaType,
      uploadUrl: plan.uploadUrl,
      uploadHeaders: plan.uploadHeaders,
      label: "Gateway file attachment",
    });
    uploadedIds.push(file.id);
  }
  if (uploadedIds.length === 0) return [];

  const response = await fetch(`${gatewayConfig.apiBaseUrl}/internal/gateway/attachments/complete`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-worker-secret": gatewayConfig.workerSecret,
      ...buildTraceHeaders(),
    },
    body: JSON.stringify({ spaceId: input.spaceId, uploadId: input.uploadId, entryIds: uploadedIds }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Gateway file attachment complete failed ${response.status}: ${text}`);
  }
  const data = await response.json().catch(() => null) as { ok?: boolean; uploaded?: Array<{ path?: string }> } | null;
  if (!data?.ok || !Array.isArray(data.uploaded)) throw new Error("Gateway file attachment complete returned an invalid response");
  return data.uploaded.map((file) => file.path).filter((path): path is string => Boolean(path));
}

export function buildUploadedFileReferencesBlock(paths: string[]): ContentBlock | null {
  const text = buildFileReferencesText(paths);
  return text ? { type: "text", text } : null;
}

export function buildUploadedImageReferencesBlock(urls: string[]): ContentBlock | null {
  const text = buildImageReferencesText(urls);
  return text ? { type: "text", text } : null;
}

export async function downloadInboundUrl(input: {
  url: string;
  maxBytes: number;
  label: string;
  allowedHosts?: string[];
  headers?: Record<string, string>;
  timeoutMs?: number;
  allowHttp?: boolean;
}) {
  const response = await safeFetch({
    url: input.url,
    label: input.label,
    allowedHosts: input.allowedHosts,
    timeoutMs: input.timeoutMs,
    allowHttp: input.allowHttp,
    init: {
      headers: {
        "User-Agent": "CohubGateway/1.0",
        ...(input.headers ?? {}),
      },
    },
  });
  if (!response.ok) throw new Error(`${input.label} download failed ${response.status}`);
  const buffer = await readResponseBufferLimited(response, input.maxBytes, input.label);
  const mediaType = response.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
  return { buffer, mediaType };
}

export async function ingestInboundMedia(input: {
  event: GatewayInboundEvent;
  source: InboundMediaSource;
  images?: InboundDownloadedImage[];
  files?: InboundDownloadedFile[];
  label?: string;
}): Promise<IngestInboundMediaResult> {
  const images = input.images ?? [];
  const files = input.files ?? [];
  const label = input.label ?? input.source;
  const empty: IngestInboundMediaResult = {
    blocks: [],
    imageBlocksById: {},
    uploadedImageUrls: [],
    uploadedFilePaths: [],
    imageFailures: 0,
    fileFailures: 0,
  };
  if (images.length === 0 && files.length === 0) return empty;

  try {
    // Deduplicate relative paths across ordinary files + image materialize copies.
    const usedRelativePaths = new Set<string>();
    const uniqueRelativePath = (raw: string, fallback: string) => {
      const base = sanitizeFilename(raw || fallback, fallback);
      if (!usedRelativePaths.has(base)) {
        usedRelativePaths.add(base);
        return base;
      }
      const dot = base.lastIndexOf(".");
      const stem = dot > 0 ? base.slice(0, dot) : base;
      const ext = dot > 0 ? base.slice(dot) : "";
      let index = 2;
      let candidate = `${stem}-${index}${ext}`;
      while (usedRelativePaths.has(candidate)) {
        index += 1;
        candidate = `${stem}-${index}${ext}`;
      }
      usedRelativePaths.add(candidate);
      return candidate;
    };

    // Images also enter the sandbox_tmp file plan so they materialize like other files.
    const plannedFiles = files.map((file) => {
      const name = sanitizeFilename(file.name, file.id);
      const relativePath = uniqueRelativePath(file.relativePath ?? name, name);
      return {
        id: file.id,
        name: relativePath.split("/").at(-1) ?? name,
        relativePath,
        size: file.buffer.length,
        mimeType: file.mediaType ?? null,
        buffer: file.buffer,
      };
    });
    const imageAsFiles = images.map((image) => {
      const fallback = `${image.id}.${imageExtensionFromMimeType(image.mediaType)}`;
      const name = uniqueRelativePath(image.filename ?? fallback, fallback);
      return {
        id: `imgfile-${image.id}`,
        name,
        relativePath: name,
        size: image.buffer.length,
        mimeType: image.mediaType,
        buffer: image.buffer,
      };
    });
    const plan = await requestGatewayAttachmentPlan({
      event: input.event,
      images: images.map((image) => ({
        id: image.id,
        size: image.buffer.length,
        mimeType: image.mediaType,
        filename: image.filename ?? `${image.id}.${imageExtensionFromMimeType(image.mediaType)}`,
      })),
      files: [
        ...plannedFiles.map((file) => ({
          id: file.id,
          name: file.name,
          relativePath: file.relativePath,
          size: file.size,
          mimeType: file.mimeType,
        })),
        ...imageAsFiles.map((file) => ({
          id: file.id,
          name: file.name,
          relativePath: file.relativePath,
          size: file.size,
          mimeType: file.mimeType,
        })),
      ],
    });

    const blocks: ContentBlock[] = [];
    const imageBlocksById: Record<string, ContentBlock> = {};
    const uploadedImageUrls: string[] = [];
    let imageFailures = 0;
    const plansById = new Map(plan.images.map((image) => [image.id, image]));

    for (const image of images) {
      const imagePlan = plansById.get(image.id);
      if (!imagePlan) {
        // Plan missing for durable image: demote to file semantics, do not fail the message.
        imageFailures += 1;
        logger.warn(`[InboundMedia:${label}] image durable plan missing; demoted to file`, { id: image.id });
        continue;
      }
      try {
        const imageBlock = await uploadPlannedImageAttachment({
          buffer: image.buffer,
          mediaType: image.mediaType,
          plan: imagePlan,
          source: input.source,
          originalUrl: image.originalUrl,
        });
        imageBlocksById[image.id] = imageBlock;
        blocks.push(imageBlock);
        uploadedImageUrls.push(imagePlan.publicUrl);
      } catch (error) {
        // Specialization failed — still send via sandbox path as a normal file.
        imageFailures += 1;
        logger.warn(`[InboundMedia:${label}] image durable upload demoted to file`, { id: image.id, error });
      }
    }

    let uploadedFilePaths: string[] = [];
    let fileFailures = 0;
    const allSandboxFiles = [
      ...plannedFiles.map((file) => ({ id: file.id, buffer: file.buffer, mediaType: file.mimeType })),
      ...imageAsFiles.map((file) => ({ id: file.id, buffer: file.buffer, mediaType: file.mimeType })),
    ];
    if (allSandboxFiles.length > 0) {
      try {
        uploadedFilePaths = await uploadPlannedFileAttachments({
          spaceId: plan.spaceId,
          uploadId: plan.files.uploadId,
          files: allSandboxFiles,
          plans: plan.files.entries,
        });
        // Prefer sandbox paths in text refs when available; durable image URLs stay on image blocks.
        const fileReferences = buildUploadedFileReferencesBlock(uploadedFilePaths);
        if (fileReferences) blocks.push(fileReferences);
        else {
          const imageReferences = buildUploadedImageReferencesBlock(uploadedImageUrls);
          if (imageReferences) blocks.push(imageReferences);
        }
        const expectedCount = files.length + images.length;
        if (uploadedFilePaths.length < expectedCount) {
          fileFailures = Math.max(0, files.length - Math.max(0, uploadedFilePaths.length - images.length));
          for (let i = 0; i < fileFailures; i += 1) {
            blocks.push({ type: "text", text: "[File upload unavailable]", _meta: { source: input.source, reason: "plan_or_complete_partial" } });
          }
        }
      } catch (error) {
        fileFailures = files.length;
        logger.warn(`[InboundMedia:${label}] file upload failed`, error);
        // Sandbox materialize failed: still expose durable image URLs for agent awareness.
        const imageReferences = buildUploadedImageReferencesBlock(uploadedImageUrls);
        if (imageReferences) blocks.push(imageReferences);
        for (const file of files) {
          blocks.push({
            type: "text",
            text: `[File upload failed: ${sanitizeFilename(file.name)}]`,
            _meta: { source: input.source, originalUrl: file.originalUrl ?? null, reason: "upload_failed" },
          });
        }
      }
    } else if (uploadedImageUrls.length > 0) {
      const imageReferences = buildUploadedImageReferencesBlock(uploadedImageUrls);
      if (imageReferences) blocks.push(imageReferences);
    }

    logger.info(`[InboundMedia:${label}] ingested`, {
      images: images.length,
      files: files.length,
      uploadedImages: uploadedImageUrls.length,
      uploadedFiles: uploadedFilePaths.length,
      imageFailures,
      fileFailures,
    });

    return { blocks, imageBlocksById, uploadedImageUrls, uploadedFilePaths, imageFailures, fileFailures };
  } catch (error) {
    logger.warn(`[InboundMedia:${label}] attachment plan failed`, error);
    const imageBlocksById: Record<string, ContentBlock> = {};
    const imageFailureBlocks = images.map((image) => {
      const block: ContentBlock = {
        type: "text",
        text: "[Image upload failed]",
        _meta: { source: input.source, originalUrl: image.originalUrl ?? null, reason: "plan_failed" },
      };
      imageBlocksById[image.id] = block;
      return block;
    });
    return {
      blocks: [
        ...imageFailureBlocks,
        ...files.map((file) => ({
          type: "text" as const,
          text: `[File upload failed: ${sanitizeFilename(file.name)}]`,
          _meta: { source: input.source, originalUrl: file.originalUrl ?? null, reason: "plan_failed" },
        })),
      ],
      imageBlocksById,
      uploadedImageUrls: [],
      uploadedFilePaths: [],
      imageFailures: images.length,
      fileFailures: files.length,
    };
  }
}

export function ensureImageMediaType(buffer: Buffer, fallback?: string | null) {
  return detectImageMimeType(buffer) ?? (fallback?.startsWith("image/") ? fallback : null) ?? "image/jpeg";
}
