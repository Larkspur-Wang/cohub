import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { assignLabelsToSession, parseLabelRef, resolveOrCreateLabelPaths } from "./index.js";

type LabelsDb = PostgresJsDatabase<Record<string, unknown>>;

export type SessionSourceLabelInput = {
  source?: string | null;
  provider?: string | null;
};

const SOURCE_LABELS: Record<string, string> = {
  public_api: "Source/Public API",
  scheduled_task: "Source/Scheduled Task",
  web: "Source/Web App",
  web_app: "Source/Web App",
  websocket: "Source/Websocket",
  cli: "Source/CLI",
  feishu: "Source/Feishu",
  slack: "Source/Slack",
  discord: "Source/Discord",
};

const normalizeKey = (value: string | null | undefined) => value?.trim().toLowerCase().replace(/[\s-]+/g, "_") || null;

export function resolveSessionSourceLabelRef(input: SessionSourceLabelInput): string {
  const providerKey = normalizeKey(input.provider);
  if (providerKey && SOURCE_LABELS[providerKey]) return SOURCE_LABELS[providerKey];

  const sourceKey = normalizeKey(input.source);
  if (!sourceKey) return "Source/Other";
  if (SOURCE_LABELS[sourceKey]) return SOURCE_LABELS[sourceKey];

  const channelPrefixMatch = sourceKey.match(/^channel[:_](.+)$/);
  const channelKey = channelPrefixMatch?.[1] ?? (sourceKey.includes(":") ? sourceKey.split(":")[0] : null);
  if (channelKey && SOURCE_LABELS[channelKey]) return SOURCE_LABELS[channelKey];

  return "Source/Other";
}

export async function assignSessionSourceSystemLabel(input: {
  db: LabelsDb;
  spaceId: string;
  sessionId: string;
  source?: string | null;
  provider?: string | null;
}) {
  const labelRef = resolveSessionSourceLabelRef({ source: input.source, provider: input.provider });
  const { labelIds } = await resolveOrCreateLabelPaths({
    db: input.db,
    spaceId: input.spaceId,
    paths: [parseLabelRef(labelRef)],
    userId: null,
    source: "system",
  });
  await assignLabelsToSession({
    db: input.db,
    spaceId: input.spaceId,
    sessionId: input.sessionId,
    labelIds,
    userId: null,
    source: "system",
  });
}
