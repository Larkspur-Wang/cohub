import type {
  ChannelConfig,
  ContentBlock,
  MessageRecord,
  ResourcePermissionLevel,
  SessionBindingRecord as ProtocolSessionBindingRecord,
  SessionRecord as ProtocolSessionRecord,
} from "@cohub/protocol";

export type {
  ChannelConfig,
  DiscordChannelConfig,
  ResourcePermissionLevel,
} from "@cohub/protocol";

export type ApiError = {
  message: string;
};

export type { ContentBlock, MessageRecord };

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

export type SessionBindingRecord = ProtocolSessionBindingRecord;

export type SessionRecord = ProtocolSessionRecord & {
  bindings?: SessionBindingRecord[];
  totalMessages?: number;
  totalToolCalls?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalCost?: string | number | null;
  shareLevel?: ResourcePermissionLevel | null;
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
  space: SpaceRecord;
  session: SessionRecord;
  messages: MessageRecord[];
};

export type SessionMessagesPaginatedResponse = {
  space: SpaceRecord;
  session: SessionRecord;
  messages: MessageRecord[];
  hasMore: boolean;
  nextCursor: number | undefined;
};

export type ModelCatalogEntry = {
  provider: string;
  id: string;
  model: Record<string, unknown>;
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
  space: SpaceRecord;
  sessions: SessionRecord[];
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

export type ResourcePermission = {
  id: string;
  resourceType: "space" | "session";
  resourceId: string;
  granteeUuid: string | null;
  level: ResourcePermissionLevel;
  createdBy: string;
  createdAt: string;
};

// ─── RBAC types ───

export type SpaceRole = "host" | "maker" | "guest";

export type SpaceMember = {
  userId: string;
  role: SpaceRole;
  createdAt: string;
  updatedAt: string;
};

export type SpaceAccessPolicy = {
  signed_in_user: SpaceRole | null;
  anonymous_user: SpaceRole | null;
};
