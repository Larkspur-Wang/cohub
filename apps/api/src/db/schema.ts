import {
  pgTable,
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
import type { UnifiedContentBlock } from "@cohub/protocol";

export const userGitAccounts = pgTable(
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
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    userUuidProviderUniqueIdx: uniqueIndex("uq_user_git_accounts_user_provider").on(
      table.userUuid,
      table.provider,
    ),
    giteaUsernameUniqueIdx: uniqueIndex("uq_user_git_accounts_gitea_username").on(
      table.giteaUsername,
    ),
    userUuidIdx: index("idx_user_git_accounts_user_uuid").on(table.userUuid),
    providerIdx: index("idx_user_git_accounts_provider").on(table.provider),
  }),
);

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userUuid: varchar("user_uuid", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    giteaRepoName: varchar("gitea_repo_name", { length: 255 }).notNull(),
    defaultBranch: varchar("default_branch", { length: 50 }).default("main"),
    visibility: varchar("visibility", { length: 20 }).default("public"),
    parentId: uuid("parent_id"),
    forkCount: integer("fork_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    userUuidIdx: index("idx_workspaces_user_uuid").on(table.userUuid),
    parentIdIdx: index("idx_workspaces_parent_id").on(table.parentId),
    visibilityIdx: index("idx_workspaces_visibility").on(table.visibility),
    userWorkspaceNameUniqueIdx: uniqueIndex("uq_workspaces_user_name").on(
      table.userUuid,
      table.name,
    ),
    userWorkspaceRepoNameUniqueIdx: uniqueIndex("uq_workspaces_user_repo_name").on(
      table.userUuid,
      table.giteaRepoName,
    ),
  }),
);

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userUuid: varchar("user_uuid", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    giteaRepoName: varchar("gitea_repo_name", { length: 255 }).notNull(),
    defaultBranch: varchar("default_branch", { length: 50 }).default("main"),
    visibility: varchar("visibility", { length: 20 }).default("public"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    userUuidIdx: index("idx_agents_user_uuid").on(table.userUuid),
  }),
);

export const userChannels = pgTable(
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
    userUuidIdx: index("idx_user_channels_user_uuid").on(table.userUuid),
    providerIdx: index("idx_user_channels_provider").on(table.provider),
  }),
);

export const runtimes = pgTable(
  "runtimes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userUuid: varchar("user_uuid", { length: 255 }).notNull(),
    workspaceId: uuid("workspace_id"),
    workspaceCommitHash: varchar("workspace_commit_hash", { length: 40 }),
    agentId: uuid("agent_id"),
    agentCommitHash: varchar("agent_commit_hash", { length: 40 }),
    title: varchar("title", { length: 255 }),
    status: varchar("status", { length: 50 }).default("active"),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    userUuidIdx: index("idx_runtimes_user_uuid").on(table.userUuid),
    workspaceIdx: index("idx_runtimes_workspace_id").on(table.workspaceId),
    agentIdx: index("idx_runtimes_agent_id").on(table.agentId),
  }),
);

export const runtimeChannels = pgTable(
  "runtime_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runtimeId: uuid("runtime_id").notNull(),
    channelId: uuid("channel_id").notNull(),
    config: jsonb("config"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    runtimeIdx: index("idx_runtime_channels_runtime").on(table.runtimeId),
    channelIdx: uniqueIndex("uq_runtime_channels_channel").on(table.channelId),
  }),
);

export const runtimeSessions = pgTable(
  "runtime_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runtimeId: uuid("runtime_id").notNull(),
    title: varchar("title", { length: 255 }),
    status: varchar("status", { length: 50 }).default("active"),
    cwd: text("cwd"),
    protocol: varchar("protocol", { length: 30 }),
    externalSessionId: text("external_session_id"),
    meta: jsonb("meta"),
    parentSessionId: uuid("parent_session_id"),
    forkedFromMessageId: uuid("forked_from_message_id"),
    lineageRootSessionId: uuid("lineage_root_session_id"),
    forkDepth: integer("fork_depth").notNull().default(0),
    latestMessageText: text("latest_message_text"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    lastMessageId: uuid("last_message_id"),
    totalMessages: integer("total_messages").notNull().default(0),
    totalToolCalls: integer("total_tool_calls").notNull().default(0),
    totalInputTokens: integer("total_input_tokens").notNull().default(0),
    totalOutputTokens: integer("total_output_tokens").notNull().default(0),
    totalCost: numeric("total_cost", { precision: 18, scale: 8 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    runtimeIdx: index("idx_runtime_sessions_runtime_id").on(table.runtimeId),
    parentIdx: index("idx_runtime_sessions_parent_session_id").on(table.parentSessionId),
    rootIdx: index("idx_runtime_sessions_lineage_root_session_id").on(table.lineageRootSessionId),
    forkedFromMessageIdx: index("idx_runtime_sessions_forked_from_message_id").on(table.forkedFromMessageId),
    lastMessageIdx: index("idx_runtime_sessions_last_message_id").on(table.lastMessageId),
    lastMessageAtIdx: index("idx_runtime_sessions_last_message_at").on(table.lastMessageAt),
  }),
);

export const runtimeSessionBindings = pgTable(
  "runtime_session_bindings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runtimeId: uuid("runtime_id").notNull(),
    runtimeSessionId: uuid("runtime_session_id").notNull(),
    runtimeChannelId: uuid("runtime_channel_id").notNull(),
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
    runtimeIdx: index("idx_runtime_session_bindings_runtime").on(table.runtimeId),
    sessionIdx: index("idx_runtime_session_bindings_session").on(table.runtimeSessionId),
    channelIdx: index("idx_runtime_session_bindings_channel").on(table.runtimeChannelId),
    bindingKeyIdx: index("idx_runtime_session_bindings_binding_key").on(table.bindingKey),
    externalChatIdx: index("idx_runtime_session_bindings_external_chat").on(table.externalChatId),
    uniqueChannelBinding: uniqueIndex("uq_runtime_session_bindings_channel_binding").on(
      table.runtimeChannelId,
      table.bindingKey,
    ),
  }),
);

export const providerMessageRefs = pgTable(
  "provider_message_refs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: varchar("provider", { length: 50 }).notNull(),
    runtimeId: uuid("runtime_id").notNull(),
    runtimeSessionId: uuid("runtime_session_id").notNull(),
    runtimeChannelId: uuid("runtime_channel_id"),
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
    providerConversationIdx: index("idx_provider_message_refs_provider_conversation").on(
      table.provider,
      table.externalConversationId,
    ),
    providerMessageIdx: uniqueIndex("uq_provider_message_refs_provider_message").on(
      table.provider,
      table.externalConversationId,
      table.externalMessageId,
      table.direction,
    ),
    runtimeSessionIdx: index("idx_provider_message_refs_runtime_session").on(
      table.runtimeSessionId,
    ),
    sessionMessageIdx: index("idx_provider_message_refs_session_message").on(
      table.sessionMessageId,
    ),
    parentMessageIdx: index("idx_provider_message_refs_parent_message").on(
      table.provider,
      table.parentExternalConversationId,
      table.parentExternalMessageId,
    ),
    runtimeChannelIdx: index("idx_provider_message_refs_runtime_channel").on(table.runtimeChannelId),
  }),
);

export const sessionMessages = pgTable(
  "session_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id").notNull(),
    role: varchar("role", { length: 20 }).notNull(),
    source: varchar("source", { length: 30 }),
    externalMessageId: text("external_message_id"),
    protocolMessageId: varchar("protocol_message_id", { length: 128 }),
    content: jsonb("content").notNull().$type<UnifiedContentBlock[]>(),
    text: text("text"),
    meta: jsonb("meta"),
    idempotencyKey: varchar("idempotency_key", { length: 255 }),
    sequence: integer("sequence").notNull(),
    prevMessageId: uuid("prev_message_id"),
    provider: varchar("provider", { length: 100 }),
    model: varchar("model", { length: 255 }),
    stopReason: varchar("stop_reason", { length: 50 }),
    errorMessage: text("error_message"),
    usageInput: integer("usage_input"),
    usageOutput: integer("usage_output"),
    usageTotalTokens: integer("usage_total_tokens"),
    costTotal: numeric("cost_total", { precision: 18, scale: 8 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    sessionIdx: index("idx_session_messages_session_id").on(table.sessionId),
    prevIdx: index("idx_session_messages_prev_message_id").on(table.prevMessageId),
    externalMessageIdx: index("idx_session_messages_external_message_id").on(table.externalMessageId),
    protocolMessageIdx: index("idx_session_messages_protocol_message_id").on(table.protocolMessageId),
    sessionSequenceUniqueIdx: uniqueIndex("uq_session_messages_session_sequence").on(table.sessionId, table.sequence),
    idempotencyKeyUniqueIdx: uniqueIndex("uq_session_messages_session_id_idempotency_key").on(table.sessionId, table.idempotencyKey),
  }),
);

export const sessionToolCalls = pgTable(
  "session_tool_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id").notNull(),
    messageId: uuid("message_id").notNull(),
    toolCallId: varchar("tool_call_id", { length: 255 }).notNull(),
    toolName: varchar("tool_name", { length: 255 }).notNull(),
    title: text("title"),
    kind: varchar("kind", { length: 50 }),
    status: varchar("status", { length: 30 }),
    args: jsonb("args"),
    result: jsonb("result"),
    content: jsonb("content"),
    locations: jsonb("locations"),
    rawInput: jsonb("raw_input"),
    rawOutput: jsonb("raw_output"),
    resultPreview: text("result_preview"),
    isError: boolean("is_error").notNull().default(false),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    sessionIdx: index("idx_session_tool_calls_session_id").on(table.sessionId),
    messageIdx: index("idx_session_tool_calls_message_id").on(table.messageId),
    toolNameIdx: index("idx_session_tool_calls_tool_name").on(table.toolName),
    kindIdx: index("idx_session_tool_calls_kind").on(table.kind),
    statusIdx: index("idx_session_tool_calls_status").on(table.status),
    sessionToolCallUniqueIdx: uniqueIndex("uq_session_tool_calls_session_tool_call_id").on(table.sessionId, table.toolCallId),
  }),
);

export const gatewayLogs = pgTable(
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
    channelIdx: index("idx_gateway_logs_channel").on(table.channelId),
    directionIdx: index("idx_gateway_logs_direction").on(table.direction),
    createdIdx: index("idx_gateway_logs_created").on(table.createdAt),
  }),
);
