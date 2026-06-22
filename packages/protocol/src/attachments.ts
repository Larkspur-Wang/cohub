export const escapeAttachmentPath = (path: string) => path.replace(/[\r\n`]/g, "_");
export const escapeAttachmentUrl = (url: string) => url.replace(/[\r\n`]/g, "_");

export function buildFileReferencesText(paths: string[]) {
  const safePaths = paths.map((path) => path.trim()).filter(Boolean);
  if (safePaths.length === 0) return "";
  return [
    "Files:",
    ...safePaths.map((path) => `- \`${escapeAttachmentPath(path)}\``),
  ].join("\n");
}

export function buildImageReferencesText(urls: string[]) {
  const safeUrls = urls.map((url) => url.trim()).filter(Boolean);
  if (safeUrls.length === 0) return "";
  return ["Images:", ...safeUrls.map((url) => `- ${escapeAttachmentUrl(url)}`)].join("\n");
}
