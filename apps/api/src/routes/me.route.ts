import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Hono } from "hono";
import { config } from "../config.js";
import { requireValidId, useAuth } from "../lib/middleware.js";

const USER_RULES_MAX_BYTES = 32 * 1024;
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

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
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
      source: "file" as const,
      path: USER_RULES_SANDBOX_PATH,
    };
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      return {
        content: "",
        updatedAt: null,
        source: "file" as const,
        path: USER_RULES_SANDBOX_PATH,
      };
    }
    throw error;
  }
}

async function writeUserRules(userId: string, content: string) {
  assertValidUserId(userId);
  const path = getUserRulesPath(userId);
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tempPath = join(dir, `.AGENTS.md.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(tempPath, content, "utf-8");
  await rename(tempPath, path);
  return readUserRules(userId);
}

async function deleteUserRules(userId: string) {
  assertValidUserId(userId);
  const path = getUserRulesPath(userId);
  try {
    await unlink(path);
  } catch (error) {
    if (getErrorCode(error) !== "ENOENT") throw error;
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

router.put("/rules", async (c) => {
  const user = useAuth(c);
  const body = await c.req.json<{ content?: unknown }>().catch(() => null);
  if (!body || typeof body.content !== "string") {
    return c.json({ message: "content is required" }, 400);
  }
  if (byteLength(body.content) > USER_RULES_MAX_BYTES) {
    return c.json({ message: `content must be at most ${USER_RULES_MAX_BYTES} bytes` }, 400);
  }

  try {
    return c.json(await writeUserRules(user.uuid, body.content));
  } catch (error) {
    return c.json({ message: error instanceof Error ? error.message : "Failed to save user rules" }, 500);
  }
});

router.delete("/rules", async (c) => {
  const user = useAuth(c);
  try {
    await deleteUserRules(user.uuid);
    return c.json({ ok: true });
  } catch (error) {
    return c.json({ message: error instanceof Error ? error.message : "Failed to delete user rules" }, 500);
  }
});

export default router;
