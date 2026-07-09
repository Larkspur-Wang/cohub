const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "heic", "heif", "avif", "tif", "tiff"]);

export function detectImageMimeType(buffer: Buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 6) {
    const header = buffer.subarray(0, 6).toString("ascii");
    if (header === "GIF87a" || header === "GIF89a") return "image/gif";
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export function imageExtensionFromMimeType(mimeType: string) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

export function isImageMimeType(value: string | null | undefined) {
  return Boolean(value?.toLowerCase().startsWith("image/"));
}

export function filenameExtension(value: string | null | undefined) {
  const name = value?.trim().toLowerCase() ?? "";
  if (!name?.includes(".")) return null;
  const ext = name.split(".").pop()?.trim() ?? "";
  return ext || null;
}

export function isImageFilename(value: string | null | undefined) {
  const ext = filenameExtension(value);
  return Boolean(ext && IMAGE_EXTENSIONS.has(ext));
}

export function looksLikeImageUrl(value: string | null | undefined) {
  if (!value) return false;
  try {
    const path = new URL(value).pathname.toLowerCase();
    return /\.(png|jpe?g|gif|webp|bmp|heic|heif|avif|tiff?)(\?|$)/i.test(path);
  } catch {
    return false;
  }
}

/** Best-effort classification before download. Prefer sniffing magic bytes after download when uncertain. */
export function classifyAttachmentKind(input: {
  contentType?: string | null;
  filename?: string | null;
  url?: string | null;
  preferImageWhenUnknown?: boolean;
}): "image" | "file" {
  const contentType = input.contentType?.trim().toLowerCase() ?? "";
  if (contentType.startsWith("image/")) return "image";
  if (contentType && contentType !== "application/octet-stream" && contentType !== "binary/octet-stream") return "file";
  if (isImageFilename(input.filename)) return "image";
  if (input.filename?.trim()) return "file";
  if (looksLikeImageUrl(input.url)) return "image";
  return input.preferImageWhenUnknown === false ? "file" : "image";
}

export function sanitizeFilename(value: string | undefined | null, fallback = "file") {
  const invalidChars = new Set(["<", ">", ":", "\"", "/", "\\", "|", "?", "*"]);
  const cleaned = Array.from(value || fallback)
    .map((char) => (invalidChars.has(char) || char.charCodeAt(0) <= 0x1f ? "_" : char))
    .join("")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 180);
  return cleaned || fallback;
}
