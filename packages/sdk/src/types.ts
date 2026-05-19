import type {
  SessionBindingRecord as ProtocolSessionBindingRecord,
  SessionRecord as ProtocolSessionRecord,
  SessionForkRecord,
  SessionTurnIndexItem,
  SessionTurnRecord,
  SessionTurnSegmentRecord,
} from "@cohub/protocol/model";
import type {
  ChannelConfig,
} from "@cohub/protocol/gateway/types";
import type {
  ContentBlock,
  Usage,
} from "@cohub/protocol/core";
import type {
  Generation,
  ListGenerationModelsResponse,
  PublicGenerationDeclaration,
  CreateGenerationRequest,
} from "@cohub/protocol/generation";
import type { MessageRecord } from "@cohub/protocol/model";

export type {
  ChannelConfig,
  DiscordChannelConfig,
} from "@cohub/protocol/gateway/types";

export type ApiError = {
  message: string;
};

export type UserProfile = {
  userUuid: string;
  logtoUserId?: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  syncedAt?: string;
};

export type MeResponse = {
  uuid: string;
  profile: UserProfile;
  email: string | null;
};

export type UserRulesResponse = {
  content: string;
  updatedAt: string | null;
  source: "config-space";
  path: string;
};

export type {
  ContentBlock,
  MessageRecord,
  SessionTurnRecord,
  SessionTurnIndexItem,
  SessionForkRecord,
  SessionTurnSegmentRecord,
  Generation,
  ListGenerationModelsResponse,
  PublicGenerationDeclaration,
  CreateGenerationRequest,
};

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
  delivery?: "inline" | "url";
  url?: string;
};
export type SpaceFsReadFilesInput = {
  paths: string[];
};
export type SpaceFsReadFilesError = {
  path: string;
  code: string;
  message: string;
  status: number;
};
export type SpaceFsPreparingFile = {
  path: string;
  name: string;
  size: number;
  mimeType: string | null;
  mtimeMs: number;
  retryAfterMs: number;
};
export type SpaceFsReadFilesResponse = {
  files: SpaceFsFileResponse[];
  preparing?: SpaceFsPreparingFile[];
  errors: SpaceFsReadFilesError[];
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
  code: "file_too_large" | "name_invalid" | "path_invalid" | "write_failed" | "object_missing";
  message: string;
};
export type SpaceFsUploadResponse = {
  uploaded: SpaceFsUploadEntry[];
  errors: SpaceFsUploadError[];
};
export type SpaceFsUploadPlanEntryInput = {
  id: string;
  name: string;
  relativePath: string;
  size: number;
  mimeType?: string | null;
  lastModified?: number;
};
export type SpaceFsCreateUploadInput = {
  targetDir?: string;
  entries: SpaceFsUploadPlanEntryInput[];
};
export type SpaceFsUploadPlanEntry = {
  id: string;
  objectKey: string;
  uploadUrl: string;
  headers?: Record<string, string>;
};
export type SpaceFsCreateUploadResponse = {
  uploadId: string;
  expiresAt: string;
  entries: SpaceFsUploadPlanEntry[];
};
export type SpaceFsCompleteUploadInput = {
  entries: Array<{ id: string; etag?: string | null }>;
};
export type SpaceFsCompleteUploadResponse = {
  ok: true;
  taskRunId: string;
};
export type SpaceFsUploadProgress = {
  phase: "queued" | "importing" | "done" | "failed";
  totalFiles: number;
  importedFiles: number;
  totalBytes: number;
  importedBytes: number;
  currentPath?: string;
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
  ownerProfile?: Pick<UserProfile, "userUuid" | "username" | "displayName" | "avatarUrl"> | null;
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

export type SessionTurnStreamSnapshotResponse = {
  snapshot: {
    version: 2;
    spaceId: string;
    sessionId: string;
    turnId: string | null;
    anchorUserMessageId: string | null;
    seq: number;
    current: {
      messageId: string | null;
      messageOrdinal: number | null;
      content: ContentBlock[];
      appendPath: string | null;
    };
    intermediateMessages: Array<{
      messageId: string | null;
      messageOrdinal: number | null;
      content: ContentBlock[];
      id?: string;
      sessionId?: string;
      role?: "user" | "assistant" | "system";
      text?: string | null;
      provider?: string | null;
      model?: string | null;
      stopReason?: string | null;
      errorMessage?: string | null;
      usage?: Usage | null;
      toolCallsObjectKey?: string | null;
      meta?: Record<string, unknown> | null;
      createdAt?: string;
    }>;
    updatedAt: number;
  } | null;
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

export type GlobalSearchType = "turn" | "session" | "space";

export type GlobalSearchResult = {
  type: GlobalSearchType;
  id: string;
  spaceId: string;
  sessionId: string | null;
  turnId: string | null;
  sequence: number | null;
  title: string;
  ownerProfile?: Pick<UserProfile, "userUuid" | "username" | "displayName" | "avatarUrl"> | null;
  matchedField: "userText" | "title" | "name" | "description";
  href: string;
  score: number;
  textScore: number;
  recencyScore: number;
  typePriorityScore: number;
  membershipPriorityScore?: number;
  updatedAt: string | null;
  source: "remote";
};

export type GlobalSearchResponse = {
  items: GlobalSearchResult[];
  query: string;
  source: "remote";
  degraded?: boolean;
};

export type SpaceSessionsResponse = {
  sessions: SessionRecord[];
  forks?: Array<SessionForkRecord & {
    firstUserTextAfterFork?: string | null;
    parentTitle?: string | null;
  }>;
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

export type CreateSpacePromptInput = {
  sessionId?: string | null;
  title?: string | null;
  content: ContentBlock[];
  model?: string | null;
  provider?: string | null;
  clientMessageId?: string | null;
  schedule?:
    | { mode?: "immediate" }
    | { mode: "delay"; delayMs: number }
    | { mode: "at"; sendAt: string }
    | { mode: "repeat"; cronExpression: string; timezone: string };
};

export type CreateSpacePromptResponse =
  | {
      ok: true;
      mode: "immediate";
      sessionId: string;
      userMessageId: string;
      turnId: string;
    }
  | {
      ok: true;
      mode: "delay" | "at";
      taskRunId: string;
      scheduledAt: string;
      sessionId: string | null;
    }
  | {
      ok: true;
      mode: "repeat";
      cronJobId: string;
      nextRunAt: string;
      timezone: string;
      sessionId: string | null;
    };

export type CronJobRecord = {
  id: string;
  userUuid: string;
  userProfile?: UserProfile;
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

export type TaskRunDetailResponse = {
  run: TaskRunRecord;
  progress: unknown;
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

// ─── RBAC types ───

export type SpaceRole = "host" | "builder" | "guest";

export type SpaceMember = {
  userId: string;
  role: SpaceRole;
  profile: UserProfile;
  createdAt: string;
  updatedAt: string;
};

export type SpaceMarkKind = "pin";

export type SpaceMarkResourceType = "session" | "checkpoint" | "file" | "space";

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


export type SpaceModListItem = {
  id: string;
  spaceId: string;
  modSpaceId: string;
  name: string | null;
  mountSlug: string;
  mountPath: string;
  enabled: boolean;
  sortOrder: number;
  createdBy: string;
  createdAt: string | null;
  updatedAt: string | null;
  modSpaceName: string | null;
  modSpaceDescription: string | null;
};

export type ExploreSpaceItem = {
  space: SpaceRecord;
  ownerProfile: Pick<UserProfile, "userUuid" | "username" | "displayName" | "avatarUrl"> | null;
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

export type ExploreSection = {
  key: string;
  title: string | null;
  subtitle: string | null;
  description: string | null;
  spaces: ExploreSpaceItem[];
};

export type ExploreSpacesResponse = {
  sections: ExploreSection[];
  spaces: ExploreSpaceItem[];
};

export type Permission =
  | "space.view"
  | "space.edit"
  | "space.pin"
  | "session.view"
  | "session.edit"
  | "session.prompt.readonly"
  | "session.prompt.fullaccess"
  | "file.view"
  | "file.edit"
  | "checkpoint.view"
  | "checkpoint.edit"
  | "member.view"
  | "member.manage"
  | "channel.view"
  | "channel.manage"
  | "cronjob.view"
  | "cronjob.manage"
  | "taskrun.view"
  | "sandbox.view"
  | "sandbox.manage"
  | "mod.view"
  | "mod.manage";

export type SpaceAccess = {
  role: SpaceRole | null;
  permissions: Permission[];
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
