import type {
  SessionBindingRecord as ProtocolSessionBindingRecord,
  SessionRecord as ProtocolSessionRecord,
  SessionTurnIndexItem,
  SessionTurnRecord,
} from "@neta-art/cohub-protocol/model";
import type {
  ChannelConfig,
} from "@neta-art/cohub-protocol/gateway";
import type {
  ContentBlock,
} from "@neta-art/cohub-protocol/core";
import type { MessageRecord } from "@neta-art/cohub-protocol/model";

export type {
  ChannelConfig,
  DiscordChannelConfig,
} from "@neta-art/cohub-protocol/gateway";

export type ApiError = {
  message: string;
};

export type UserRulesResponse = {
  content: string;
  updatedAt: string | null;
  source: "config-space";
  path: string;
};

export type { ContentBlock, MessageRecord, SessionTurnRecord, SessionTurnIndexItem };

export type SpaceFsEntry = {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink";
  size: number;
  mimeType: string | null;
  mtimeMs: number;
};

export type SpaceFsTreeResponse = { path: string; entries: SpaceFsEntry[] };
export type SpaceFsFileKind = "text" | "binary";
export type SpaceFsEncoding = "utf-8" | "base64";
export type SpaceFsFileResponse = {
  path: string;
  name: string;
  size: number;
  mimeType: string | null;
  mtimeMs: number;
  kind: SpaceFsFileKind;
  encoding: SpaceFsEncoding;
  content: string;
};
export type SpaceFsWriteFileInput = {
  path: string;
  content: string;
  encoding: SpaceFsEncoding;
};
export type SpaceFsMoveInput = { fromPath: string; toPath: string };
export type SpaceFsUploadEntry = {
  path: string;
  name: string;
  size: number;
  mimeType: string | null;
  mtimeMs: number;
};
export type SpaceFsUploadError = {
  name: string;
  code: "file_too_large" | "name_invalid" | "write_failed";
  message: string;
};
export type SpaceFsUploadResponse = {
  uploaded: SpaceFsUploadEntry[];
  errors: SpaceFsUploadError[];
};

export type SessionBindingRecord = ProtocolSessionBindingRecord;

export type SessionRecord = ProtocolSessionRecord & {
  bindings?: SessionBindingRecord[];
  totalMessages?: number;
  totalToolCalls?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalCost?: string | number | null;
};

export type SpaceGitInfo = {
  giteaHost: string;
  giteaUsername: string;
};

export type SpaceRecord = {
  id: string;
  userUuid: string;
  name: string | null;
  description: string | null;
  storageRepoName?: string | null;
  baseCheckpointId?: string | null;
  headCheckpointId?: string | null;
  title: string | null;
  status: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  channels?: {
    id: string;
    name: string | null;
    provider: string;
    status: string;
  }[];
  accessLevel?: "minimal";
  gitInfo?: SpaceGitInfo | null;
};

export type SpaceBootstrapSource =
  | { type: "blank" }
  | { type: "git_repo"; repoUrl?: string; ref?: string | null }
  | { type: "checkpoint"; checkpointId: string };

export type SpaceCreateResponse = {
  space: SpaceRecord;
  taskRunId: string;
};

export type SpaceListItem = SpaceRecord;

export type SessionMessagesResponse = {
  session: SessionRecord;
  messages: MessageRecord[];
};

export type SessionMessageResponse = {
  session: SessionRecord;
  message: MessageRecord;
};

export type SessionMessagesPaginatedResponse = {
  session: SessionRecord;
  messages: MessageRecord[];
  hasMore: boolean;
  nextCursor: number | undefined;
};

export type SessionTurnsPaginatedResponse = {
  session: SessionRecord;
  turns: SessionTurnRecord[];
  hasMore: boolean;
  nextCursor: number | undefined;
};

export type SessionTurnIndexResponse = {
  session: SessionRecord;
  turns: SessionTurnIndexItem[];
  hasMore: boolean;
  nextCursor: number | undefined;
};

export type SessionTurnWindowResponse = {
  session: SessionRecord;
  turns: SessionTurnRecord[];
  hasMoreOlder: boolean;
  hasMoreNewer: boolean;
  oldestCursor: number | undefined;
  newestCursor: number | undefined;
  anchorSequence: number | undefined;
};

export type SessionTurnResponse = {
  session: SessionRecord;
  turn: SessionTurnRecord;
};

export type SessionTurnSignedUrlsResponse = {
  urls: Record<string, string>;
};

export type ModelCatalogEntry = {
  provider: string;
  id: string;
  model: Record<string, unknown>;
};

export type PromptTemplateCatalogEntry = {
  name: string;
  description: string;
  argumentHint?: string;
  category?: string;
  scope: "platform";
};

export type PromptTemplateCatalogResponse = {
  prompts: PromptTemplateCatalogEntry[];
};

export type Channel = {
  id: string;
  userUuid: string;
  provider: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  boundSpace: {
    id: string;
    title: string | null;
    status: string;
  } | null;
};

export type SpaceEnvInput = {
  name: string;
  value: string;
};

export type SpaceChannelBindingInput = {
  channelId: string;
  config?: ChannelConfig | null;
};

export type SpaceSessionsResponse = {
  sessions: SessionRecord[];
  pageInfo?: {
    hasMore: boolean;
    nextCursor: string | null;
  };
};

export type UserSshKey = {
  id: string;
  key: string;
  title: string;
  giteaKeyId: number;
  createdAt: string;
};

export type CronJobRecord = {
  id: string;
  userUuid: string;
  title: string;
  taskType: string;
  payload: Record<string, unknown>;
  cronExpression: string;
  timezone: string;
  bullJobKey: string;
  spaceId: string | null;
  sessionId: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TaskRunRecord = {
  id: string;
  jobId: string;
  cronJobId: string | null;
  taskType: string;
  status: "pending" | "running" | "completed" | "failed";
  payload: unknown;
  result: unknown;
  errorMessage: string | null;
  attemptCount: number;
  spaceId: string | null;
  sessionId: string | null;
  userUuid: string | null;
  scheduledAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CheckpointRecord = {
  id: string;
  spaceId: string;
  commitHash: string;
  description: string;
  parentCheckpointId: string | null;
  forkCount: number;
  meta: Record<string, unknown> | null;
  createdAt: string;
};

export type SpaceCheckpointDetailResponse = {
  checkpoint: CheckpointRecord;
};

export type CreateCronJobInput = {
  title: string;
  taskType: string;
  payload: Record<string, unknown>;
  cronExpression: string;
  timezone?: string;
  spaceId?: string;
  sessionId?: string;
};

export type CreateScheduledTaskInput = {
  taskType: string;
  payload: Record<string, unknown>;
  scheduleAt: string;
  spaceId?: string;
  sessionId?: string;
};

// ─── RBAC types ───

export type SpaceRole = "host" | "builder" | "guest";

export type SpaceMember = {
  userId: string;
  role: SpaceRole;
  createdAt: string;
  updatedAt: string;
};

export type SpaceMarkKind = "pin";

export type SpaceMarkResourceType = "session" | "checkpoint" | "file";

export type SpaceMarkRecord = {
  id: string;
  spaceId: string;
  kind: SpaceMarkKind;
  resourceType: SpaceMarkResourceType;
  resourceRef: string;
  label: string | null;
  rank: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type SpaceMarkListItem = SpaceMarkRecord & {
  href: string;
  resource: {
    title: string;
    subtitle: string | null;
    status: string | null;
  } | null;
};

export type ExploreSpaceItem = {
  space: SpaceRecord;
  accessAudience: "anonymous" | "signed_in";
  explore: {
    rank: number;
    category: string | null;
    label: string | null;
  };
  latestCheckpoints: CheckpointRecord[];
  stats: {
    pinnedCount: number;
    checkpointCount: number;
    forkCount: number;
  };
  sandboxStatus: string | null;
};

export type SpaceAccessPolicy = {
  signed_in_user: SpaceRole | null;
  anonymous_user: SpaceRole | null;
};

export type SpaceUsageHourlyStat = {
  bucketStartAt: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costInput: number;
  costOutput: number;
  costCacheRead: number;
  costCacheWrite: number;
  costTotal: number;
  requestCount: number;
  successCount: number;
  errorCount: number;
  models: string[];
};

export type SpaceUsageSummary = {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costInput: number;
  costOutput: number;
  costCacheRead: number;
  costCacheWrite: number;
  costTotal: number;
  requestCount: number;
  successCount: number;
  errorCount: number;
};

export type SpaceUsageResponse = {
  hourly: SpaceUsageHourlyStat[];
  summary: SpaceUsageSummary;
  days: number;
};

// ─── Invitation types ───

export type SpaceInvitation = {
  token: string;
  role: SpaceRole;
  status: "active" | "revoked" | "exhausted";
  useCount: number;
  maxUses: number | null;
  createdAt: string | null;
  expiresInSeconds: number | null;
};

export type CreateInvitationInput = {
  role?: SpaceRole;
  ttlSeconds?: number;
  maxUses?: number;
};

export type CreateInvitationResponse = {
  token: string;
  role: SpaceRole;
  expiresAt: string;
  maxUses: number | null;
};

export type InvitationDetail = {
  token: string;
  spaceId: string;
  spaceName: string;
  role: SpaceRole;
  expiresInSeconds: number | null;
};

export type AcceptInvitationResponse = {
  ok: true;
  spaceId: string;
  spaceName: string;
  role: SpaceRole;
};
