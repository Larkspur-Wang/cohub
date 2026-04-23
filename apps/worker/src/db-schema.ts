import {
  pgSchema,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  jsonb,
} from "drizzle-orm/pg-core";
import type { TaskPayload } from "@neta-art/cohub-protocol/task";

export const v2 = pgSchema("v2");

export const spaces = v2.table("spaces", {
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
});

export const checkpoints = v2.table("checkpoints", {
  id: uuid("id").primaryKey().defaultRandom(),
  spaceId: uuid("space_id").notNull(),
  commitHash: varchar("commit_hash", { length: 40 }).notNull(),
  description: text("description").notNull(),
  parentCheckpointId: uuid("parent_checkpoint_id"),
  forkCount: integer("fork_count").notNull().default(0),
  meta: jsonb("meta"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const userGitAccounts = v2.table("user_git_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userUuid: varchar("user_uuid", { length: 255 }).notNull(),
  provider: varchar("provider", { length: 50 }).notNull().default("gitea"),
  giteaUserId: integer("gitea_user_id").notNull(),
  giteaUsername: varchar("gitea_username", { length: 255 }).notNull(),
  giteaPasswordEncrypted: text("gitea_password_encrypted").notNull(),
  giteaAccessTokenEncrypted: text("gitea_access_token_encrypted").notNull(),
  status: varchar("status", { length: 20 }).default("active"),
  lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
  sshPublicKeys: jsonb("ssh_public_keys"),
  meta: jsonb("meta"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

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
);
