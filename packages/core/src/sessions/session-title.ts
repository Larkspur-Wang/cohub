import { spaceSessions } from "@cohub/db";
import type { ContentBlock } from "@cohub/protocol/core";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sanitizePostgresJsonValue } from "../content/sanitize.js";
import {
  canClaimSessionFallbackTitle,
  normalizeSessionTitle,
  setSessionTitleMeta,
} from "./session-meta.js";

export type SessionTitleDatabase = PostgresJsDatabase<Record<string, unknown>>;
type TitleContentBlock = Extract<ContentBlock, { type: "text" | "image" }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function projectTitleContent(value: unknown): TitleContentBlock[] | null {
  if (!Array.isArray(value)) return null;
  const content: TitleContentBlock[] = [];
  for (const block of value) {
    if (!isRecord(block)) return null;
    if (block.type === "text") {
      if (typeof block.text !== "string") return null;
      content.push(block as TitleContentBlock);
      continue;
    }
    if (block.type === "image") {
      const source = isRecord(block.source) ? block.source : null;
      const validUrl = source?.type === "url" && typeof source.url === "string" && Boolean(source.url.trim());
      const validBase64 = source?.type === "base64"
        && typeof source.media_type === "string"
        && Boolean(source.media_type.trim())
        && typeof source.data === "string"
        && Boolean(source.data);
      if (!validUrl && !validBase64) return null;
      content.push(block as TitleContentBlock);
      continue;
    }
    return null;
  }
  return content;
}

function generationRequestContent(content: TitleContentBlock[]): TitleContentBlock[] | null {
  const requestText = content.find((block) => block.type === "text")?.text;
  if (!requestText) return null;
  try {
    const request = JSON.parse(requestText) as unknown;
    if (!isRecord(request) || request.type !== "generation.request") return null;
    return projectTitleContent(request.content);
  } catch {
    return null;
  }
}

export async function claimSessionFallbackTitle(
  db: SessionTitleDatabase,
  input: { sessionId: string; title: string },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [session] = await tx.select().from(spaceSessions)
      .where(eq(spaceSessions.id, input.sessionId))
      .for("update")
      .limit(1);
    if (!session || !canClaimSessionFallbackTitle(session.title, session.meta)) return false;
    await tx.update(spaceSessions).set({
      title: input.title,
      meta: sanitizePostgresJsonValue(setSessionTitleMeta(session.meta, { source: "fallback" })),
      updatedAt: new Date(),
    }).where(eq(spaceSessions.id, input.sessionId));
    return true;
  });
}

export function deriveSessionFallbackTitle(input: {
  content: ContentBlock[];
  text?: string | null;
  generationRequest?: boolean;
}): string | null {
  const originalContent = projectTitleContent(input.content);
  if (!originalContent) return null;
  const sourceContent = input.generationRequest
    ? generationRequestContent(originalContent)
    : originalContent;
  if (!sourceContent) return null;

  const hasImages = sourceContent.some((block) => block.type === "image");
  const contentText = sourceContent
    .filter((block): block is Extract<TitleContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join(" ");
  const text = contentText || (!input.generationRequest && !hasImages ? input.text ?? "" : "");
  return normalizeSessionTitle(text.replace(/^[:\-\s]+/, ""))
    ?? (hasImages ? "Image" : null);
}
