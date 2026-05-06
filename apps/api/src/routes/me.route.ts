import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { config } from "../config.js";
import { requireValidId, useAuth } from "../lib/middleware.js";

const USER_RULES_FILE_NAME = "AGENTS.md";
const USER_RULES_SANDBOX_PATH = "/configs/user/AGENTS.md";

const router = new Hono();

function getUserRulesPath(userId: string) {
  return join(config.platformConfigRoot, "users", userId, USER_RULES_FILE_NAME);
}

function assertValidUserId(userId: string) {
  if (!requireValidId(userId)) {
    throw new Error("invalid user id");
  }
}

function getErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

async function readUserRules(userId: string) {
  assertValidUserId(userId);
  const path = getUserRulesPath(userId);
  try {
    const [content, fileStat] = await Promise.all([
      readFile(path, "utf-8"),
      stat(path),
    ]);
    return {
      content,
      updatedAt: fileStat.mtime.toISOString(),
      source: "config-space" as const,
      path: USER_RULES_SANDBOX_PATH,
    };
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      return {
        content: "",
        updatedAt: null,
        source: "config-space" as const,
        path: USER_RULES_SANDBOX_PATH,
      };
    }
    throw error;
  }
}

router.get("/", (c) => {
  const user = useAuth(c);
  return c.json(user);
});

router.get("/rules", async (c) => {
  const user = useAuth(c);
  try {
    return c.json(await readUserRules(user.uuid));
  } catch (error) {
    return c.json({ message: error instanceof Error ? error.message : "Failed to load user rules" }, 500);
  }
});

export default router;
