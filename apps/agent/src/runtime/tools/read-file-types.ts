export const SUPPORTED_READ_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export const SUPPORTED_READ_IMAGE_MIME_TYPE_LABEL = "image/jpeg, image/png, image/gif, image/webp";

export function isSupportedReadImageMimeType(mimeType: string | null | undefined): boolean {
  return mimeType != null && SUPPORTED_READ_IMAGE_MIME_TYPES.has(mimeType);
}

export function detectUnsupportedReadImageMimeType(mimeType: string | null | undefined): string | null {
  if (!mimeType?.startsWith("image/")) return null;
  return isSupportedReadImageMimeType(mimeType) ? null : mimeType;
}

export function unsupportedReadImageMimeTypeMessage(mimeType: string) {
  return `Unsupported image type: ${mimeType}. Supported image types: ${SUPPORTED_READ_IMAGE_MIME_TYPE_LABEL}.`;
}

export function detectReadImageMimeType(path: string, data?: Buffer): string | null {
  const lower = path.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg") || lower.endsWith(".svgz")) return "image/svg+xml";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".ico")) return "image/x-icon";

  if (!data || data.length < 4) return null;
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data.subarray(0, 6).toString("ascii") === "GIF87a" || data.subarray(0, 6).toString("ascii") === "GIF89a") return "image/gif";
  if (data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}
