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

// 工作区表 (Workspace)
export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userUuid: varchar("user_uuid", { length: 255 }).notNull(), // 外部 User UUID (Owner)
    name: varchar("name", { length: 255 }).notNull(), // 工作区名称
    description: text("description"), // 简要描述
    giteaRepoName: varchar("gitea_repo_name", { length: 255 }).notNull(), // 例如 "user/cyberpunk-city"
    defaultBranch: varchar("default_branch", { length: 50 }).default("main"),
    visibility: varchar("visibility", { length: 20 }).default("public"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => {
    return {
      userUuidIdx: index("idx_workspaces_user_uuid").on(table.userUuid),
    };
  },
);

// 智能体/角色表 (Agent)
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
  (table) => {
    return {
      userUuidIdx: index("idx_agents_user_uuid").on(table.userUuid),
    };
  },
);

// 会话表 (Session)
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userUuid: varchar("user_uuid", { length: 255 }).notNull(), // 会话所属用户 UUID
    workspaceId: uuid("workspace_id").references(() => workspaces.id),
    workspaceCommitHash: varchar("workspace_commit_hash", { length: 40 }), // 锁定 Workspace 版本
    agentId: uuid("agent_id").references(() => agents.id),
    agentCommitHash: varchar("agent_commit_hash", { length: 40 }), // 锁定 Agent 版本

    title: varchar("title", { length: 255 }), // 会话标题
    status: varchar("status", { length: 50 }).default("active"), // active, running, completed, aborted, error, archived

    // 树状会话展示字段（不强加 FK，避免自循环迁移复杂度）
    rootMessageId: uuid("root_message_id"),
    currentLeafMessageId: uuid("current_leaf_message_id"),

    latestMessageText: text("latest_message_text"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),

    totalMessages: integer("total_messages").notNull().default(0),
    totalToolCalls: integer("total_tool_calls").notNull().default(0),
    totalBranches: integer("total_branches").notNull().default(1),

    totalInputTokens: integer("total_input_tokens").notNull().default(0),
    totalOutputTokens: integer("total_output_tokens").notNull().default(0),
    totalCost: numeric("total_cost", { precision: 18, scale: 8 })
      .notNull()
      .default("0"),

    rawSessionOssKey: text("raw_session_oss_key"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => {
    return {
      userUuidIdx: index("idx_sessions_user_uuid").on(table.userUuid),
      currentLeafIdx: index("idx_sessions_current_leaf_message_id").on(
        table.currentLeafMessageId,
      ),
      lastMessageAtIdx: index("idx_sessions_last_message_at").on(
        table.lastMessageAt,
      ),
    };
  },
);

// 会话消息树节点表
export const sessionMessages = pgTable(
  "session_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),

    role: varchar("role", { length: 20 }).notNull(), // user | assistant | system
    content: jsonb("content").notNull(), // block array
    text: text("text"), // 平铺文本，用于预览/搜索

    parentMessageId: uuid("parent_message_id"),

    idempotencyKey: varchar("idempotency_key", { length: 255 }),

    depth: integer("depth").notNull().default(0),
    branchId: uuid("branch_id").notNull(),
    branchIndex: integer("branch_index"),

    childCount: integer("child_count").notNull().default(0),
    isBranchPoint: boolean("is_branch_point").notNull().default(false),
    isLeaf: boolean("is_leaf").notNull().default(true),

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
  (table) => {
    return {
      sessionIdx: index("idx_session_messages_session_id").on(table.sessionId),
      parentIdx: index("idx_session_messages_parent_message_id").on(
        table.parentMessageId,
      ),
      idempotencyKeyUniqueIdx: uniqueIndex(
        "uq_session_messages_session_id_idempotency_key",
      ).on(table.sessionId, table.idempotencyKey),
      branchIdx: index("idx_session_messages_branch_id").on(table.branchId),
      sessionBranchCreatedIdx: index(
        "idx_session_messages_session_branch_created_at",
      ).on(table.sessionId, table.branchId, table.createdAt),
      sessionLeafIdx: index("idx_session_messages_session_is_leaf").on(
        table.sessionId,
        table.isLeaf,
      ),
      sessionDepthIdx: index("idx_session_messages_session_depth").on(
        table.sessionId,
        table.depth,
      ),
    };
  },
);

// 助手消息中的工具调用
export const sessionToolCalls = pgTable(
  "session_tool_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    messageId: uuid("message_id")
      .notNull()
      .references(() => sessionMessages.id, { onDelete: "cascade" }),

    toolCallId: varchar("tool_call_id", { length: 255 }).notNull(),
    toolName: varchar("tool_name", { length: 255 }).notNull(),

    args: jsonb("args"),
    result: jsonb("result"),
    resultPreview: text("result_preview"),
    isError: boolean("is_error").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => {
    return {
      sessionIdx: index("idx_session_tool_calls_session_id").on(table.sessionId),
      messageIdx: index("idx_session_tool_calls_message_id").on(table.messageId),
      toolNameIdx: index("idx_session_tool_calls_tool_name").on(table.toolName),
      sessionToolCallUniqueIdx: uniqueIndex(
        "uq_session_tool_calls_session_tool_call_id",
      ).on(table.sessionId, table.toolCallId),
    };
  },
);
