import type { AuthUser } from "../lib/middleware.js";
import { hasPermission } from "../permissions.js";
import type { GenerationSource } from "@cohub/protocol";
import { GenerationHttpError } from "./errors.js";
import { readSpaceFile, SpaceFsError } from "../space-fs.js";

export async function resolveSourceAsUrlOrDataUri(source: GenerationSource, user: AuthUser): Promise<string> {
  switch (source.type) {
    case "url":
      return source.url;
    case "base64":
      return `data:${source.media_type};base64,${source.data}`;
    case "space_file": {
      if (!await hasPermission(user, "file.view", { spaceId: source.space_id })) {
        throw new GenerationHttpError(403, "space_file_forbidden", "No permission to read space file");
      }
      try {
        const file = await readSpaceFile(source.space_id, source.path);
        if (!("content" in file)) {
          throw new GenerationHttpError(202, "space_file_preparing", "Space file is being prepared. Please retry shortly.");
        }
        if (file.delivery === "url" && file.url) return file.url;
        const mediaType = file.mimeType ?? "application/octet-stream";
        const data = file.encoding === "base64" ? file.content : Buffer.from(file.content, "utf8").toString("base64");
        return `data:${mediaType};base64,${data}`;
      } catch (error) {
        if (error instanceof SpaceFsError) {
          throw new GenerationHttpError(error.status, error.code, error.message);
        }
        throw error;
      }
    }
  }
}
