import type { ContentBlock } from "@cohub/protocol/core";
import type { GatewayInboundEvent } from "@cohub/protocol/gateway";
import { createLogger } from "@cohub/infra/logging";
import {
  downloadInboundUrl,
  ensureImageMediaType,
  ingestInboundMedia,
  type InboundDownloadedFile,
  type InboundDownloadedImage,
} from "../../media/inbound-attachments.js";
import {
  classifyAttachmentKind,
  detectImageMimeType,
  imageExtensionFromMimeType,
  isImageFilename,
  isImageMimeType,
  looksLikeImageUrl,
  sanitizeFilename,
} from "../../media/mime.js";
import type { QQMessageAttachment, QQMsgElement } from "./types.js";

const logger = createLogger({ serviceName: "cohub-gateway" });

const QQ_INBOUND_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const QQ_INBOUND_FILE_MAX_BYTES = 50 * 1024 * 1024;
const QQ_INBOUND_IMAGE_MAX_COUNT = 4;
const QQ_INBOUND_FILE_MAX_COUNT = 4;
const QQ_DOWNLOAD_ALLOWED_HOST_SUFFIXES = ["qq.com", "gtimg.cn", "qpic.cn", "myqcloud.com"];
const QQ_DOWNLOAD_TIMEOUT_MS = 10_000;

export function collectQQAttachments(input: {
  attachments?: QQMessageAttachment[];
  msgElements?: QQMsgElement[];
}): QQMessageAttachment[] {
  const collected: QQMessageAttachment[] = [];
  const seen = new Set<string>();

  const push = (attachment: QQMessageAttachment | undefined | null) => {
    if (!attachment?.url) return;
    const key = `${attachment.url}|${attachment.filename ?? ""}|${attachment.content_type ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    collected.push(attachment);
  };

  for (const attachment of input.attachments ?? []) push(attachment);

  const walk = (elements: QQMsgElement[] | undefined) => {
    for (const element of elements ?? []) {
      for (const attachment of element.attachments ?? []) push(attachment);
      if (element.msg_elements?.length) walk(element.msg_elements);
    }
  };
  walk(input.msgElements);

  return collected;
}

async function downloadQQAttachment(url: string, maxBytes: number, label: string) {
  return downloadInboundUrl({
    url,
    maxBytes,
    label,
    allowedHosts: QQ_DOWNLOAD_ALLOWED_HOST_SUFFIXES,
    timeoutMs: QQ_DOWNLOAD_TIMEOUT_MS,
    headers: { "User-Agent": "CohubGateway/1.0 QQBotProvider" },
  });
}

export async function buildQQInboundMediaBlocks(input: {
  event: GatewayInboundEvent;
  attachments?: QQMessageAttachment[];
  channelId: string;
}): Promise<ContentBlock[]> {
  const attachments = (input.attachments ?? []).filter((attachment) => Boolean(attachment.url));
  if (attachments.length === 0) return [];

  const images: InboundDownloadedImage[] = [];
  const files: InboundDownloadedFile[] = [];
  const blocks: ContentBlock[] = [];
  let imageSeen = 0;
  let fileSeen = 0;

  for (const [index, attachment] of attachments.entries()) {
    const sourceUrl = attachment.url;
    if (!sourceUrl) continue;

    const declaredKind = classifyAttachmentKind({
      contentType: attachment.content_type,
      filename: attachment.filename,
      url: attachment.url,
      preferImageWhenUnknown: true,
    });
    const maxBytes = declaredKind === "image" ? QQ_INBOUND_IMAGE_MAX_BYTES : QQ_INBOUND_FILE_MAX_BYTES;

    let downloaded: { buffer: Buffer; mediaType: string };
    try {
      downloaded = await downloadQQAttachment(sourceUrl, maxBytes, `qq:${input.channelId}:attachment`);
    } catch (error) {
      logger.warn(`[QQ:${input.channelId}] attachment download failed`, { url: sourceUrl, error });
      blocks.push({
        type: "text",
        text: declaredKind === "image"
          ? "[Image unavailable]"
          : `[Attachment unavailable: ${sanitizeFilename(attachment.filename, "file")}]`,
        _meta: { source: "qq", originalUrl: sourceUrl, reason: "download_failed" },
      });
      continue;
    }

    const magicImage = detectImageMimeType(downloaded.buffer);
    const asImage = Boolean(magicImage)
      || isImageMimeType(attachment.content_type)
      || isImageFilename(attachment.filename)
      || looksLikeImageUrl(attachment.url)
      || declaredKind === "image";

    if (asImage) {
      imageSeen += 1;
      if (imageSeen > QQ_INBOUND_IMAGE_MAX_COUNT) {
        blocks.push({ type: "text", text: "[Image skipped: too many images]", _meta: { source: "qq", originalUrl: sourceUrl } });
        continue;
      }
      const mediaType = magicImage ?? ensureImageMediaType(downloaded.buffer, attachment.content_type ?? downloaded.mediaType);
      const ext = imageExtensionFromMimeType(mediaType);
      images.push({
        id: `image-${images.length}`,
        buffer: downloaded.buffer,
        mediaType,
        filename: sanitizeFilename(attachment.filename, `qq-image-${index + 1}.${ext}`),
        originalUrl: sourceUrl,
      });
      continue;
    }

    fileSeen += 1;
    if (fileSeen > QQ_INBOUND_FILE_MAX_COUNT) {
      blocks.push({ type: "text", text: "[File skipped: too many files]", _meta: { source: "qq", originalUrl: sourceUrl } });
      continue;
    }
    const name = sanitizeFilename(attachment.filename, `qq-file-${index + 1}`);
    files.push({
      id: `file-${files.length}`,
      buffer: downloaded.buffer,
      mediaType: attachment.content_type ?? downloaded.mediaType,
      name,
      relativePath: name,
      originalUrl: sourceUrl,
    });
  }

  if (images.length === 0 && files.length === 0) return blocks;

  const ingested = await ingestInboundMedia({
    event: input.event,
    source: "qq",
    images,
    files,
    label: `qq:${input.channelId}`,
  });
  return [...blocks, ...ingested.blocks];
}
