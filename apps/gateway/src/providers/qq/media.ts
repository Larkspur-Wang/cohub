import dns from "node:dns/promises";
import net from "node:net";
import type { ContentBlock } from "@cohub/protocol/core";
import type { GatewayInboundEvent } from "@cohub/protocol/gateway";
import { buildFileReferencesText, buildImageReferencesText } from "@cohub/protocol";
import { buildTraceHeaders } from "@cohub/infra/tracing";
import { gatewayConfig } from "../../config.js";
import type { QQMessageAttachment } from "./types.js";

const QQ_INBOUND_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const QQ_INBOUND_FILE_MAX_BYTES = 50 * 1024 * 1024;
const QQ_INBOUND_IMAGE_MAX_COUNT = 4;
const QQ_INBOUND_FILE_MAX_COUNT = 4;
const QQ_DOWNLOAD_TIMEOUT_MS = 10_000;
const QQ_DOWNLOAD_ALLOWED_HOST_SUFFIXES = [".qq.com", ".gtimg.cn", ".qpic.cn", ".myqcloud.com"];

const detectImageMime = (buffer: Buffer, fallback = "image/jpeg") => {
  if (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 4 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return "image/gif";
  if (buffer.length >= 12 && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return fallback;
};

const isPrivateIp = (address: string) => {
  if (net.isIP(address) === 4) {
    const parts = address.split(".").map(Number);
    const a = parts[0] ?? 0;
    const b = parts[1] ?? 0;
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 0;
  }
  if (net.isIP(address) === 6) {
    const value = address.toLowerCase();
    return value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80:");
  }
  return true;
};

async function assertSafeQQAttachmentUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("QQ attachment URL must use HTTPS");
  const hostname = url.hostname.toLowerCase();
  if (!QQ_DOWNLOAD_ALLOWED_HOST_SUFFIXES.some((suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix))) {
    throw new Error("QQ attachment host is not allowed");
  }
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  if (records.some((record) => isPrivateIp(record.address))) throw new Error("QQ attachment resolved to a private address");
}

async function readResponseLimited(response: Response, maxBytes: number) {
  if (!response.body) return Buffer.from(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("QQ attachment is too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

async function downloadAttachment(url: string, maxBytes: number) {
  await assertSafeQQAttachmentUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QQ_DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "CohubGateway/1.0 QQBotProvider" } });
    if (!response.ok) throw new Error(`QQ attachment download failed ${response.status}`);
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (contentLength > maxBytes) throw new Error("QQ attachment is too large");
    const buffer = await readResponseLimited(response, maxBytes);
    return { buffer, mediaType: response.headers.get("content-type") ?? "application/octet-stream" };
  } finally {
    clearTimeout(timer);
  }
}

async function downloadImage(url: string) {
  const { buffer, mediaType } = await downloadAttachment(url, QQ_INBOUND_IMAGE_MAX_BYTES);
  return {
    buffer,
    mediaType: detectImageMime(buffer, mediaType),
  };
}

async function requestImagePlan(input: {
  event: GatewayInboundEvent;
  images: Array<{ id: string; size: number; mimeType: string; filename: string }>;
}) {
  const response = await fetch(`${gatewayConfig.apiBaseUrl}/internal/gateway/attachments/plan`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-worker-secret": gatewayConfig.workerSecret,
      ...buildTraceHeaders({ requestId: input.event.eventId }),
    },
    body: JSON.stringify({ event: input.event, images: input.images, files: [] }),
  });
  if (!response.ok) throw new Error(`Gateway attachment plan failed ${response.status}: ${await response.text().catch(() => "")}`);
  const data = await response.json().catch(() => null) as { ok?: boolean; images?: Array<{ id: string; filename: string | null; objectKey: string; publicUrl: string; uploadUrl: string; uploadHeaders?: Record<string, string> }> } | null;
  if (!data?.ok || !Array.isArray(data.images)) throw new Error("Gateway attachment plan returned an invalid response");
  return data.images;
}

async function uploadImage(input: { buffer: Buffer; mediaType: string; uploadUrl: string; uploadHeaders?: Record<string, string> }) {
  const response = await fetch(input.uploadUrl, {
    method: "PUT",
    headers: {
      "content-type": input.mediaType,
      ...(input.uploadHeaders ?? {}),
    },
    body: new Uint8Array(input.buffer),
  });
  if (!response.ok) throw new Error(`Gateway image upload failed ${response.status}`);
}

export async function buildQQInboundImageBlocks(input: {
  event: GatewayInboundEvent;
  attachments?: QQMessageAttachment[];
}) {
  const imageAttachments = (input.attachments ?? [])
    .filter((attachment) => attachment.url && attachment.content_type?.startsWith("image/"))
    .slice(0, QQ_INBOUND_IMAGE_MAX_COUNT);
  if (imageAttachments.length === 0) return [] as ContentBlock[];

  const downloaded: Array<{ id: string; sourceUrl: string; buffer: Buffer; mediaType: string; filename: string }> = [];
  const fallbackBlocks: ContentBlock[] = [];
  for (const [index, attachment] of imageAttachments.entries()) {
    const sourceUrl = attachment.url;
    if (!sourceUrl) continue;
    try {
      const image = await downloadImage(sourceUrl);
      const ext = image.mediaType.split("/")[1] ?? "jpg";
      downloaded.push({
        id: `image-${index}`,
        sourceUrl,
        buffer: image.buffer,
        mediaType: image.mediaType,
        filename: attachment.filename ?? `qq-image-${index + 1}.${ext}`,
      });
    } catch {
      fallbackBlocks.push({ type: "image", source: { type: "url", url: sourceUrl } });
    }
  }

  if (downloaded.length === 0) return fallbackBlocks;
  try {
    const plans = await requestImagePlan({
      event: input.event,
      images: downloaded.map((image) => ({ id: image.id, size: image.buffer.length, mimeType: image.mediaType, filename: image.filename })),
    });
    const plansById = new Map(plans.map((plan) => [plan.id, plan]));
    const publicUrls: string[] = [];
    for (const image of downloaded) {
      const plan = plansById.get(image.id);
      if (!plan) continue;
      await uploadImage({ buffer: image.buffer, mediaType: image.mediaType, uploadUrl: plan.uploadUrl, uploadHeaders: plan.uploadHeaders });
      publicUrls.push(plan.publicUrl);
    }
    const blocks: ContentBlock[] = publicUrls.map((url) => ({ type: "image", source: { type: "url", url } }));
    const references = buildImageReferencesText(publicUrls);
    if (references) blocks.push({ type: "text", text: references });
    return [...blocks, ...fallbackBlocks];
  } catch {
    return [
      ...downloaded.map((image) => ({ type: "image" as const, source: { type: "url" as const, url: image.sourceUrl } })),
      ...fallbackBlocks,
    ];
  }
}

async function requestFilePlan(input: {
  event: GatewayInboundEvent;
  files: Array<{ id: string; name: string; relativePath: string; size: number; mimeType: string }>;
}) {
  const response = await fetch(`${gatewayConfig.apiBaseUrl}/internal/gateway/attachments/plan`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-worker-secret": gatewayConfig.workerSecret,
      ...buildTraceHeaders({ requestId: input.event.eventId }),
    },
    body: JSON.stringify({ event: input.event, images: [], files: input.files }),
  });
  if (!response.ok) throw new Error(`Gateway file plan failed ${response.status}: ${await response.text().catch(() => "")}`);
  const data = await response.json().catch(() => null) as { ok?: boolean; spaceId?: string; files?: { uploadId?: string | null; entries?: Array<{ id: string; name: string; relativePath: string; uploadUrl: string; uploadHeaders?: Record<string, string> }> } } | null;
  if (!data?.ok || !data.spaceId || !Array.isArray(data.files?.entries)) throw new Error("Gateway file plan returned an invalid response");
  return { spaceId: data.spaceId, uploadId: data.files.uploadId ?? null, entries: data.files.entries };
}

async function completeFileUpload(input: { spaceId: string; uploadId: string | null; entryIds: string[] }) {
  if (!input.uploadId || input.entryIds.length === 0) return [] as string[];
  const response = await fetch(`${gatewayConfig.apiBaseUrl}/internal/gateway/attachments/complete`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-worker-secret": gatewayConfig.workerSecret,
      ...buildTraceHeaders(),
    },
    body: JSON.stringify({ spaceId: input.spaceId, uploadId: input.uploadId, entryIds: input.entryIds }),
  });
  if (!response.ok) throw new Error(`Gateway file complete failed ${response.status}: ${await response.text().catch(() => "")}`);
  const data = await response.json().catch(() => null) as { ok?: boolean; uploaded?: Array<{ path?: string }> } | null;
  if (!data?.ok || !Array.isArray(data.uploaded)) throw new Error("Gateway file complete returned an invalid response");
  return data.uploaded.map((file) => file.path).filter((path): path is string => Boolean(path));
}

export async function buildQQInboundFileBlocks(input: {
  event: GatewayInboundEvent;
  attachments?: QQMessageAttachment[];
}): Promise<ContentBlock[]> {
  const fileAttachments = (input.attachments ?? [])
    .filter((attachment) => attachment.url && !attachment.content_type?.startsWith("image/"))
    .slice(0, QQ_INBOUND_FILE_MAX_COUNT);
  if (fileAttachments.length === 0) return [] as ContentBlock[];

  const downloaded: Array<{ id: string; buffer: Buffer; mediaType: string; name: string; relativePath: string }> = [];
  const fallback: string[] = [];
  for (const [index, attachment] of fileAttachments.entries()) {
    const sourceUrl = attachment.url;
    if (!sourceUrl) continue;
    try {
      const file = await downloadAttachment(sourceUrl, QQ_INBOUND_FILE_MAX_BYTES);
      const name = attachment.filename ?? `qq-file-${index + 1}`;
      downloaded.push({ id: `file-${index}`, buffer: file.buffer, mediaType: attachment.content_type ?? file.mediaType, name, relativePath: name });
    } catch {
      fallback.push(`[Attachment: ${attachment.filename ?? attachment.content_type ?? sourceUrl}]`);
    }
  }
  if (downloaded.length === 0) return fallback.map((text) => ({ type: "text", text }));

  try {
    const plan = await requestFilePlan({
      event: input.event,
      files: downloaded.map((file) => ({ id: file.id, name: file.name, relativePath: file.relativePath, size: file.buffer.length, mimeType: file.mediaType })),
    });
    const entriesById = new Map(plan.entries.map((entry) => [entry.id, entry]));
    const uploadedIds: string[] = [];
    for (const file of downloaded) {
      const entry = entriesById.get(file.id);
      if (!entry) continue;
      const response = await fetch(entry.uploadUrl, {
        method: "PUT",
        headers: { "content-type": file.mediaType, ...(entry.uploadHeaders ?? {}) },
        body: new Uint8Array(file.buffer),
      });
      if (!response.ok) throw new Error(`Gateway file upload failed ${response.status}`);
      uploadedIds.push(file.id);
    }
    const paths = await completeFileUpload({ spaceId: plan.spaceId, uploadId: plan.uploadId, entryIds: uploadedIds });
    const references = buildFileReferencesText(paths);
    return references ? [{ type: "text", text: references }, ...fallback.map((text) => ({ type: "text" as const, text }))] : fallback.map((text) => ({ type: "text", text }));
  } catch {
    return [
      ...downloaded.map((file) => ({ type: "text" as const, text: `[Attachment: ${file.name}]` })),
      ...fallback.map((text) => ({ type: "text" as const, text })),
    ];
  }
}
