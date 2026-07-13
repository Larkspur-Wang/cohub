import type { HttpTransport } from "../transport.js";

export type PublicAssetPurpose = "user_avatar" | "space_avatar" | "chat_attachment";
/** Avatar + preprocessed chat images. General chat files may use any mime string. */
export type PublicAssetMimeType = "image/webp" | "image/jpeg";

export type CreatePublicAssetUploadInput = {
  purpose: PublicAssetPurpose;
  spaceId?: string;
  sessionId?: string;
  file: {
    size: number;
    mimeType: string;
    filename?: string;
  };
};

export type CreatePublicAssetUploadResponse = {
  expiresAt: string;
  asset: {
    purpose: PublicAssetPurpose;
    objectKey: string;
    publicUrl: string;
    uploadMethod: "POST";
    uploadUrl: string;
    uploadFields: Record<string, string>;
  };
};

export type UploadPublicAssetInput = {
  purpose: PublicAssetPurpose;
  spaceId?: string;
  sessionId?: string;
  file: Blob;
  mimeType: string;
  filename?: string;
};

export type UploadChatAttachmentInput = {
  /** Optional association only; upload is user-scoped. */
  spaceId?: string;
  /** Optional association only; upload is user-scoped. */
  sessionId?: string;
  file: Blob;
  mimeType: string;
  filename?: string;
};

/** @deprecated Prefer UploadChatAttachmentInput — images are a special case of chat attachments. */
export type UploadChatImageAttachmentInput = UploadChatAttachmentInput & {
  mimeType: PublicAssetMimeType;
};

export class PublicAssetsApi {
  constructor(private readonly transport: HttpTransport) {}

  createUpload(input: CreatePublicAssetUploadInput) {
    return this.transport.request<CreatePublicAssetUploadResponse>("/api/public-assets/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  }

  async upload(input: UploadPublicAssetInput) {
    const plan = await this.createUpload({
      purpose: input.purpose,
      spaceId: input.spaceId,
      sessionId: input.sessionId,
      file: {
        size: input.file.size,
        mimeType: input.mimeType,
        filename: input.filename,
      },
    });
    const formData = new FormData();
    for (const [key, value] of Object.entries(plan.asset.uploadFields)) {
      formData.append(key, value);
    }
    if (input.filename) formData.append("file", input.file, input.filename);
    else formData.append("file", input.file);
    const response = await fetch(plan.asset.uploadUrl, {
      method: plan.asset.uploadMethod,
      body: formData,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Public asset upload failed: HTTP ${response.status}${detail ? ` — ${detail}` : ""}`);
    }
    return plan.asset;
  }

  /** Durable public upload for any chat attachment (image or file). No space required. */
  uploadChatAttachment(input: UploadChatAttachmentInput) {
    return this.upload({
      purpose: "chat_attachment",
      spaceId: input.spaceId,
      sessionId: input.sessionId,
      file: input.file,
      mimeType: input.mimeType,
      filename: input.filename,
    });
  }

  /** Preprocessed chat image (webp/jpeg). Same durable path as uploadChatAttachment. */
  uploadChatImageAttachment(input: UploadChatImageAttachmentInput) {
    return this.uploadChatAttachment(input);
  }
}
