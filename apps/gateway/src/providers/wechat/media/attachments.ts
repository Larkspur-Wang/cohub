import { buildFileReferencesText, buildImageReferencesText } from "@cohub/protocol";
import type { ContentBlock } from "@cohub/protocol/core";
import type { GatewayInboundEvent } from "@cohub/protocol/gateway";
import { buildTraceHeaders } from "@cohub/infra/tracing";
import { gatewayConfig } from "../../../config.js";

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
      source: "wechat",
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
