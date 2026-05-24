import type { HttpTransport } from "../transport.js";

export type PublicAssetPurpose = "user_avatar" | "space_avatar";

export type CreatePublicAssetUploadInput = {
  purpose: PublicAssetPurpose;
  spaceId?: string;
  file: {
    size: number;
    mimeType: "image/webp";
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

export class PublicAssetsApi {
  constructor(private readonly transport: HttpTransport) {}

  createUpload(input: CreatePublicAssetUploadInput) {
    return this.transport.request<CreatePublicAssetUploadResponse>("/api/public-assets/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  }
}
