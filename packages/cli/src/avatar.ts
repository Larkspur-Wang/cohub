import sharp from "sharp";
import type { CohubHttpClient, PublicAssetPurpose } from "@neta-art/cohub";

const AVATAR_SIZE = 1024;
const AVATAR_QUALITY = 86;

export async function normalizeAvatarFile(path: string): Promise<Buffer> {
  return sharp(path)
    .rotate()
    .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "centre" })
    .webp({ quality: AVATAR_QUALITY })
    .toBuffer();
}

export async function uploadAvatarAsset(input: {
  client: CohubHttpClient;
  purpose: PublicAssetPurpose;
  path: string;
  spaceId?: string;
}) {
  const body = await normalizeAvatarFile(input.path);
  const plan = await input.client.publicAssets.createUpload({
    purpose: input.purpose,
    spaceId: input.spaceId,
    file: {
      size: body.byteLength,
      mimeType: "image/webp",
    },
  });
  const formData = new FormData();
  for (const [key, value] of Object.entries(plan.asset.uploadFields)) {
    formData.append(key, value);
  }
  formData.append("file", new Blob([new Uint8Array(body)], { type: "image/webp" }), "avatar.webp");
  const response = await fetch(plan.asset.uploadUrl, {
    method: plan.asset.uploadMethod,
    body: formData,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Avatar upload failed: HTTP ${response.status}${detail ? ` — ${detail}` : ""}`);
  }
  return plan.asset;
}
