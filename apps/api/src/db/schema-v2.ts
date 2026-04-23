import {
  pgSchema,
  uuid,
  varchar,
  text,
  timestamp,
  index,
  integer,
  numeric,
  boolean,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { ContentBlock } from "@cohub/protocol/core";
import type { TaskPayload } from "@cohub/protocol/task";

export type SpaceRole = "host" | "maker" | "guest";
export type AccessPolicyRole = "maker" | "guest" | null;
export type AccessPolicyResourceType = "space" | "session";

export const v2 = pgSchema("v2");

export const userGitAccounts = v2.table(
  "user_git_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userUuid: varchar("user_uuid", { length: 255 }).notNull(),
    provider: varchar("provider", { length: 50 }).notNull().default("gitea"),
    giteaUserId: integer("gitea_user_id").notNull(),
    giteaUsername: varchar("gitea_username", { length: 255 }).notNull(),
    giteaPasswordEncrypted: text("gitea_password_encrypted").notNull(),
    giteaAccessTokenEncrypted: text("gitea_access_token_encrypted").notNull(),
    status: varchar("status", { length: 20 }).default("active"),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    sshPublicKeys: jsonb("ssh_public_keys").$type<Array<{
      id: string;
      key: string;
      title: string;
      giteaKeyId: number;
      createdAt: string;
    }>>(),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    userUuidProviderUniqueIdx: uniqueIndex("v2_uq_user_git_accounts_user_provider").on(
      table.userUuid,
      table.provider,
    ),
    giteaUsernameUniqueIdx: uniqueIndex("v2_uq_user_git_accounts_gitea_username").on(
      table.giteaUsername,
    ),
    userUuidIdx: index("v2_idx_user_git_accounts_user_uuid").on(table.userUuid),
    providerIdx: index("v2_idx_user_git_accounts_provider").on(table.provider),
  }),
);

export const userChannels = v2.table(
  "user_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userUuid: varchar("user_uuid", { length: 255 }).notNull(),
    provider: varchar("provider", { length: 50 }).notNull(),
    name: varchar("name", { length: 255 }),
    credentials: jsonb("credentials").notNull(),
    status: varchar("status", { length: 20 }).default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    userUuidIdx: index("v2_idx_user_channels_user_uuid").on(table.userUuid),
    providerIdx: index("v2_idx_user_channels_provider").on(table.provider),
  }),
);

export const spaces = v2.table(
  "spaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userUuid: varchar("user_uuid", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    storageRepoName: varchar("storage_repo_name", { length: 255 }).notNull(),
    baseCheckpointId: uuid("base_checkpoint_id"),
    headCheckpointId: uuid("head_checkpoint_id"),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    userUuidIdx: index("v2_idx_spaces_user_uuid").on(table.userUuid),
    baseCheckpointIdx: index("v2_idx_spaces_base_checkpoint_id").on(table.baseCheckpointId),
    headCheckpointIdx: index("v2_idx_spaces_head_checkpoint_id").on(table.headCheckpointId),
    userSpaceNameUniqueIdx: uniqueIndex("v2_uq_spaces_user_name").on(table.userUuid, table.name),
    storageRepoNameUniqueIdx: uniqueIndex("v2_uq_spaces_storage_repo_name").on(
      table.storageRepoName,
    ),
  }),
);

export const spaceSandboxes = v2.table(
  "space_sandboxes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull(),
    status: varchar("status", { length: 30 }).notNull().default("pending"),
    podName: varchar("pod_name", { length: 255 }),
    desiredImage: text("desired_image"),
    reportedImageVersion: varchar("reported_image_version", { length: 255 }),
    reportedAt: timestamp("reported_at", { withTimezone: true }),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    spaceIdx: uniqueIndex("v2_uq_space_sandboxes_space_id").on(table.spaceId),
    statusIdx: index("v2_idx_space_sandboxes_status").on(table.status),
    desiredImageIdx: index("v2_idx_space_sandboxes_desired_image").on(table.desiredImage),
    reportedImageVersionIdx: index("v2_idx_space_sandboxes_reported_image_version").on(table.reportedImageVersion),
    heartbeatIdx: index("v2_idx_space_sandboxes_last_heartbeat_at").on(table.lastHeartbeatAt),
  }),
);

export const checkpoints = v2.table(
  "checkpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull(),
    commitHash: varchar("commit_hash", { length: 40 }).notNull(),
    description: text("description").notNull(),
    parentCheckpointId: uuid("parent_checkpoint_id"),
    forkCount: integer("fork_count").notNull().default(0),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    spaceIdx: index("v2_idx_checkpoints_space_id").on(table.spaceId),
    parentIdx: index("v2_idx_checkpoints_parent_id").on(table.parentCheckpointId),
    spaceCommitUniqueIdx: uniqueIndex("v2_uq_checkpoints_space_commit").on(
      table.spaceId,
      table.commitHash,
    ),
  }),
);

export const proposals = v2.table(
  "proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    sourceCheckpointId: uuid("source_checkpoint_id").notNull(),
    targetSpaceId: uuid("target_space_id").notNull(),
    sourceBranchName: varchar("source_branch_name", { length: 255 }),
    targetBranchName: varchar("target_branch_name", { length: 255 }),
    externalPrId: varchar("external_pr_id", { length: 255 }),
    status: varchar("status", { length: 20 }).default("open"),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    targetSpaceIdx: index("v2_idx_proposals_target_space_id").on(table.targetSpaceId),
    sourceCheckpointIdx: index("v2_idx_proposals_source_checkpoint_id").on(table.sourceCheckpointId),
    statusIdx: index("v2_idx_proposals_status").on(table.status),
  }),
);

export const spaceChannels = v2.table(
  "space_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull(),
    channelId: uuid("channel_id").notNull(),
    config: jsonb("config"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    spaceIdx: index("v2_idx_space_channels_space").on(table.spaceId),
    channelIdx: uniqueIndex("v2_uq_space_channels_channel").on(table.channelId),
  }),
);

export const spaceSessions = v2.table(
  "space_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull(),
    title: varchar("title", { length: 255 }),
    source: varchar("source", { length: 255 }),
    status: varchar("status", { length: 50 }).default("active"),
    externalSessionId: text("external_session_id"),
    meta: jsonb("meta"),
    parentSessionId: uuid("parent_session_id"),
    forkedFromMessageId: uuid("forked_from_message_id"),
    lineageRootSessionId: uuid("lineage_root_session_id"),
    forkDepth: integer("fork_depth").notNull().default(0),
    latestMessageText: text("latest_message_text"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    lastMessageId: uuid("last_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    spaceIdx: index("v2_idx_space_sessions_space_id").on(table.spaceId),
    parentIdx: index("v2_idx_space_sessions_parent_session_id").on(table.parentSessionId),
    rootIdx: index("v2_idx_space_sessions_lineage_root_session_id").on(table.lineageRootSessionId),
    forkedFromMessageIdx: index("v2_idx_space_sessions_forked_from_message_id").on(
      table.forkedFromMessageId,
    ),
    lastMessageIdx: index("v2_idx_space_sessions_last_message_id").on(table.lastMessageId),
    lastMessageAtIdx: index("v2_idx_space_sessions_last_message_at").on(table.lastMessageAt),
  }),
);

export const spaceSessionBindings = v2.table(
  "space_session_bindings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull(),
    spaceSessionId: uuid("space_session_id").notNull(),
    spaceChannelId: uuid("space_channel_id").notNull(),
    provider: varchar("provider", { length: 50 }).notNull(),
    bindingKey: varchar("binding_key", { length: 255 }).notNull(),
    externalChatId: varchar("external_chat_id", { length: 255 }).notNull(),
    status: varchar("status", { length: 20 }).default("active"),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  },
  (table) => ({
    spaceIdx: index("v2_idx_space_session_bindings_space").on(table.spaceId),
    sessionIdx: index("v2_idx_space_session_bindings_session").on(table.spaceSessionId),
    channelIdx: index("v2_idx_space_session_bindings_channel").on(table.spaceChannelId),
    bindingKeyIdx: index("v2_idx_space_session_bindings_binding_key").on(table.bindingKey),
    externalChatIdx: index("v2_idx_space_session_bindings_external_chat").on(table.externalChatId),
    uniqueChannelBinding: uniqueIndex("v2_uq_space_session_bindings_channel_binding").on(
      table.spaceChannelId,
      table.bindingKey,
    ),
  }),
);

export const providerMessageRefs = v2.table(
  "provider_message_refs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: varchar("provider", { length: 50 }).notNull(),
    spaceId: uuid("space_id").notNull(),
    spaceSessionId: uuid("space_session_id").notNull(),
    spaceChannelId: uuid("space_channel_id"),
    sessionMessageId: uuid("session_message_id"),
    direction: varchar("direction", { length: 20 }).notNull(),
    externalConversationId: varchar("external_conversation_id", { length: 255 }).notNull(),
    externalMessageId: varchar("external_message_id", { length: 255 }).notNull(),
    parentExternalConversationId: varchar("parent_external_conversation_id", { length: 255 }),
    parentExternalMessageId: varchar("parent_external_message_id", { length: 255 }),
    externalAuthorId: varchar("external_author_id", { length: 255 }),
    externalAuthorName: varchar("external_author_name", { length: 255 }),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    providerConversationIdx: index("v2_idx_provider_message_refs_provider_conversation").on(
      table.provider,
      table.externalConversationId,
    ),
    providerMessageIdx: uniqueIndex("v2_uq_provider_message_refs_provider_message").on(
      table.provider,
      table.externalConversationId,
      table.externalMessageId,
      table.direction,
    ),
    spaceSessionIdx: index("v2_idx_provider_message_refs_space_session").on(table.spaceSessionId),
    sessionMessageIdx: index("v2_idx_provider_message_refs_session_message").on(
      table.sessionMessageId,
    ),
    parentMessageIdx: index("v2_idx_provider_message_refs_parent_message").on(
      table.provider,
      table.parentExternalConversationId,
      table.parentExternalMessageId,
    ),
    spaceChannelIdx: index("v2_idx_provider_message_refs_space_channel").on(table.spaceChannelId),
  }),
);

export const sessionMessages = v2.table(
  "session_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id").notNull(),
    role: varchar("role", { length: 20 }).notNull(),
    content: jsonb("content").notNull().$type<ContentBlock[]>(),
    text: text("text"),
    provider: varchar("provider", { length: 100 }),
    model: varchar("model", { length: 255 }),
    stopReason: varchar("stop_reason", { length: 50 }),
    errorMessage: text("error_message"),
    sequence: integer("sequence").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 255 }),
    usage: jsonb("usage").$type<import("@cohub/protocol").Usage | null>(),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    sessionIdx: index("v2_idx_session_messages_session_id").on(table.sessionId),
    sessionSequenceUniqueIdx: uniqueIndex("v2_uq_session_messages_session_sequence").on(
      table.sessionId,
      table.sequence,
    ),
    idempotencyKeyUniqueIdx: uniqueIndex("v2_uq_session_messages_session_id_idempotency_key").on(
      table.sessionId,
      table.idempotencyKey,
    ),
  }),
);

export const tokenUsageStatsHourly = v2.table(
  "token_usage_stats_hourly",
  {
    bucketStartAt: timestamp("bucket_start_at", { withTimezone: true }).notNull(),
    userId: varchar("user_id", { length: 255 }),
    spaceId: uuid("space_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    provider: varchar("provider", { length: 100 }),
    model: varchar("model", { length: 255 }),
    requestCount: integer("request_count").notNull().default(0),
    successCount: integer("success_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    costInput: numeric("cost_input", { precision: 18, scale: 8 }).notNull().default("0"),
    costOutput: numeric("cost_output", { precision: 18, scale: 8 }).notNull().default("0"),
    costCacheRead: numeric("cost_cache_read", { precision: 18, scale: 8 }).notNull().default("0"),
    costCacheWrite: numeric("cost_cache_write", { precision: 18, scale: 8 }).notNull().default("0"),
    costTotal: numeric("cost_total", { precision: 18, scale: 8 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    pk: uniqueIndex("v2_uq_token_usage_stats_hourly_bucket_dims").on(
      table.bucketStartAt,
      table.userId,
      table.spaceId,
      table.sessionId,
      table.provider,
      table.model,
    ),
    bucketIdx: index("v2_idx_token_usage_stats_hourly_bucket").on(table.bucketStartAt),
    userBucketIdx: index("v2_idx_token_usage_stats_hourly_user_bucket").on(table.userId, table.bucketStartAt),
    spaceBucketIdx: index("v2_idx_token_usage_stats_hourly_space_bucket").on(table.spaceId, table.bucketStartAt),
    sessionBucketIdx: index("v2_idx_token_usage_stats_hourly_session_bucket").on(table.sessionId, table.bucketStartAt),
    providerModelBucketIdx: index("v2_idx_token_usage_stats_hourly_provider_model_bucket").on(table.provider, table.model, table.bucketStartAt),
  }),
);

export const gatewayLogs = v2.table(
  "gateway_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    direction: varchar("direction", { length: 10 }).notNull(),
    provider: varchar("provider", { length: 50 }).notNull(),
    channelId: uuid("channel_id"),
    externalChatId: varchar("external_chat_id", { length: 255 }),
    rawPayload: jsonb("raw_payload").notNull(),
    normalizedPayload: jsonb("normalized_payload"),
    status: varchar("status", { length: 20 }).default("success"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    channelIdx: index("v2_idx_gateway_logs_channel").on(table.channelId),
    directionIdx: index("v2_idx_gateway_logs_direction").on(table.direction),
    createdIdx: index("v2_idx_gateway_logs_created").on(table.createdAt),
  }),
);

export const spaceMembers = v2.table(
  "space_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull(),
    userId: varchar("user_id", { length: 255 }).notNull(),
    role: varchar("role", { length: 20 }).$type<SpaceRole>().notNull(),
    createdBy: varchar("created_by", { length: 255 }).notNull(),
    updatedBy: varchar("updated_by", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    uniqueSpaceUserIdx: uniqueIndex("v2_uq_space_members_space_user").on(
      table.spaceId,
      table.userId,
    ),
    spaceIdx: index("v2_idx_space_members_space").on(table.spaceId),
    userIdx: index("v2_idx_space_members_user").on(table.userId),
    spaceRoleIdx: index("v2_idx_space_members_space_role").on(table.spaceId, table.role),
  }),
);

export const accessPolicies = v2.table(
  "access_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    resourceType: varchar("resource_type", { length: 20 }).$type<AccessPolicyResourceType>().notNull(),
    resourceId: uuid("resource_id").notNull(),
    signedInUserRole: varchar("signed_in_user_role", { length: 20 }).$type<SpaceRole | null>(),
    anonymousUserRole: varchar("anonymous_user_role", { length: 20 }).$type<SpaceRole | null>(),
    createdBy: varchar("created_by", { length: 255 }).notNull(),
    updatedBy: varchar("updated_by", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    uniqueResourceIdx: uniqueIndex("v2_uq_access_policies_resource").on(
      table.resourceType,
      table.resourceId,
    ),
    resourceIdx: index("v2_idx_access_policies_resource").on(table.resourceType, table.resourceId),
  }),
);

export const cronJobs = v2.table(
  "cron_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userUuid: varchar("user_uuid", { length: 255 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    taskType: varchar("task_type", { length: 100 }).notNull(),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    cronExpression: varchar("cron_expression", { length: 100 }).notNull(),
    timezone: varchar("timezone", { length: 50 }).notNull().default("Asia/Shanghai"),
    bullJobKey: varchar("bull_job_key", { length: 500 }).notNull(),
    spaceId: uuid("space_id"),
    sessionId: uuid("session_id"),
    enabled: boolean("enabled").notNull().default(true),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    userIdx: index("v2_idx_cron_jobs_user_uuid").on(table.userUuid),
    spaceIdx: index("v2_idx_cron_jobs_space_id").on(table.spaceId),
    enabledIdx: index("v2_idx_cron_jobs_enabled").on(table.enabled),
    createdAtIdx: index("v2_idx_cron_jobs_created_at").on(table.createdAt),
  }),
);

export const taskRuns = v2.table(
  "task_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: varchar("job_id", { length: 255 }).notNull(),
    cronJobId: uuid("cron_job_id"),
    taskType: varchar("task_type", { length: 100 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    payload: jsonb("payload").notNull().$type<TaskPayload>(),
    result: jsonb("result"),
    errorMessage: text("error_message"),
    attemptCount: integer("attempt_count").notNull().default(0),
    spaceId: uuid("space_id"),
    sessionId: uuid("session_id"),
    userUuid: varchar("user_uuid", { length: 255 }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    jobIdUniqueIdx: uniqueIndex("v2_uq_task_runs_job_id").on(table.jobId),
    cronJobIdx: index("v2_idx_task_runs_cron_job_id").on(table.cronJobId),
    spaceIdx: index("v2_idx_task_runs_space_id").on(table.spaceId),
    sessionIdx: index("v2_idx_task_runs_session_id").on(table.sessionId),
    userIdx: index("v2_idx_task_runs_user_uuid").on(table.userUuid),
    statusIdx: index("v2_idx_task_runs_status").on(table.status),
    createdAtIdx: index("v2_idx_task_runs_created_at").on(table.createdAt),
    scheduledAtIdx: index("v2_idx_task_runs_scheduled_at").on(table.scheduledAt),
  }),
);
