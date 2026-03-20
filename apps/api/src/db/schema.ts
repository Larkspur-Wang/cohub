import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index,
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
    status: varchar("status", { length: 50 }).default("active"), // active, paused, archived

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => {
    return {
      userUuidIdx: index("idx_sessions_user_uuid").on(table.userUuid),
    };
  },
);
