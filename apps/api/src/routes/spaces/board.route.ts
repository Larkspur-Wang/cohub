import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { boardNodes, boards } from "@cohub/db";
import {
  BOARD_EXTENSION,
  BoardCreateInputSchema,
  BoardInspectInputSchema,
  BoardPlaybackCommandSchema,
  isBoardPath,
  serializeBoardManifest,
  type BoardOperation,
} from "@cohub/protocol";
import {
  applyBoardPlaybackCommand,
  applyBoardTransaction,
  BoardServiceError,
  getBoardCapabilities,
  inspectBoard,
  normalizeBoardOperation,
  normalizeBoardTransaction,
  normalizeNodes,
  validateBoardTransaction,
} from "../../board-service.js";
import { db } from "../../db/index.js";
import { authzDenied, getOptionalAuth, requireValidId, useAuth } from "../../lib/middleware.js";
import { hasPermission } from "../../permissions.js";
import {
  assertSafeRelativePath,
  createSpaceFileExclusive,
  deleteSpaceNode,
  SpaceFsError,
} from "../../space-fs-backend.js";
import { dispatchSpaceFsChanged } from "../../space-events.js";

const router = new Hono();

function errorResponse(error: unknown) {
  if (error instanceof BoardServiceError) return { status: error.status, message: error.message, code: error.code };
  if (error instanceof SpaceFsError) return { status: error.status, message: error.message, code: undefined };
  return { status: 500, message: "Board operation failed", code: undefined };
}

router.post("/", async (c) => {
  const user = useAuth(c);
  if (user instanceof Response) return user;
  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "file.edit", { spaceId }))) return authzDenied(c);

  const rawBody = await c.req.json<unknown>().catch(() => null);
  const parsedBody = BoardCreateInputSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return c.json({ message: parsedBody.error.issues[0]?.message ?? "invalid Board input" }, 400);
  }
  const body = parsedBody.data;
  let path: string;
  try {
    path = assertSafeRelativePath(body.path);
  } catch (error) {
    const response = errorResponse(error);
    return c.json({ message: response.message, code: response.code }, response.status as never);
  }
  if (!isBoardPath(path)) return c.json({ message: `path must end with ${BOARD_EXTENSION}` }, 400);
  const title = (body.title?.trim() || path.split("/").at(-1) || "Board").slice(0, 255);
  let nodes: ReturnType<typeof normalizeNodes>;
  let operations: BoardOperation[];
  try {
    nodes = normalizeNodes(body.nodes ?? []);
    operations = [
      ...(body.effects ?? []).map((effect): BoardOperation => ({ type: "effect.upsert", payload: { effect } })),
      ...(body.sequences ?? []).map(({ sequence, clips }): BoardOperation => ({ type: "sequence.upsert", payload: { sequence, clips } })),
    ].map(normalizeBoardOperation);
  } catch (error) {
    const response = errorResponse(error);
    return c.json({ message: response.message, code: response.code }, response.status as never);
  }

  const boardId = crypto.randomUUID();
  let written: Awaited<ReturnType<typeof createSpaceFileExclusive>> | null = null;
  try {
    written = await createSpaceFileExclusive(spaceId, {
      path,
      content: serializeBoardManifest({ kind: "cohub.board.manifest", version: 1, boardId, title }),
      encoding: "utf-8",
    });
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.insert(boards).values({ id: boardId, spaceId, title, version: 0, metadata: {}, createdAt: now, updatedAt: now });
      if (nodes.length) {
        await tx.insert(boardNodes).values(nodes.map((node, index) => ({
          ...node,
          boardId,
          orderKey: node.orderKey ?? String(index).padStart(8, "0"),
          version: 0,
          createdAt: now,
          updatedAt: now,
        })));
      }
    });

    const result = operations.length
      ? await applyBoardTransaction({
          spaceId,
          actorId: user.uuid,
          transaction: { txId: crypto.randomUUID(), boardId, baseVersion: 0, operations },
        })
      : await inspectBoard(spaceId, boardId);

    await dispatchSpaceFsChanged(spaceId, {
      source: "api-fs",
      changes: [{ path: written.path, kind: "create", nodeType: "file", size: written.size, mtimeMs: written.mtimeMs }],
    }).catch(() => undefined);
    return c.json(result);
  } catch (error) {
    await db.delete(boards).where(and(eq(boards.id, boardId), eq(boards.spaceId, spaceId))).catch(() => undefined);
    if (written) await deleteSpaceNode(spaceId, written.path).catch(() => undefined);
    const response = errorResponse(error);
    return c.json({ message: response.message, code: response.code }, response.status as never);
  }
});

router.get("/:boardId", async (c) => {
  const user = getOptionalAuth(c);
  const spaceId = c.req.param("id");
  const boardId = c.req.param("boardId");
  if (!spaceId || !boardId || !requireValidId(spaceId) || !requireValidId(boardId)) return c.json({ message: "board not found" }, 404);
  if (!(await hasPermission(user, "file.view", { spaceId }))) return authzDenied(c);
  let viewport: unknown;
  const viewportParam = c.req.query("viewport");
  if (viewportParam) {
    try {
      viewport = JSON.parse(viewportParam);
    } catch {
      return c.json({ message: "viewport must be valid JSON" }, 400);
    }
  }
  const include = c.req.queries("include") ?? [];
  const parsedInput = BoardInspectInputSchema.safeParse({
    include: include.length > 0 ? include : undefined,
    viewport,
  });
  if (!parsedInput.success) return c.json({ message: parsedInput.error.issues[0]?.message ?? "invalid inspect input" }, 400);
  try {
    return c.json(await inspectBoard(spaceId, boardId, parsedInput.data));
  } catch (error) {
    const response = errorResponse(error);
    return c.json({ message: response.message, code: response.code }, response.status as never);
  }
});

router.get("/:boardId/capabilities", async (c) => {
  const user = getOptionalAuth(c);
  const spaceId = c.req.param("id");
  const boardId = c.req.param("boardId");
  if (!spaceId || !boardId || !requireValidId(spaceId) || !requireValidId(boardId)) return c.json({ message: "board not found" }, 404);
  if (!(await hasPermission(user, "file.view", { spaceId }))) return authzDenied(c);
  try {
    return c.json(await getBoardCapabilities(spaceId, boardId));
  } catch (error) {
    const response = errorResponse(error);
    return c.json({ message: response.message, code: response.code }, response.status as never);
  }
});

router.post("/:boardId/validate", async (c) => {
  const user = useAuth(c);
  if (user instanceof Response) return user;
  const spaceId = c.req.param("id");
  const boardId = c.req.param("boardId");
  if (!spaceId || !boardId || !requireValidId(spaceId) || !requireValidId(boardId)) return c.json({ message: "board not found" }, 404);
  if (!(await hasPermission(user, "file.edit", { spaceId }))) return authzDenied(c);
  const body = await c.req.json<unknown>().catch(() => null);
  try {
    const transaction = normalizeBoardTransaction(body);
    if (transaction.boardId !== boardId) throw new BoardServiceError(400, "transaction boardId does not match route");
    return c.json(await validateBoardTransaction({ spaceId, value: transaction }));
  } catch (error) {
    const response = errorResponse(error);
    return c.json({ message: response.message, code: response.code }, response.status as never);
  }
});

router.post("/:boardId/transactions", async (c) => {
  const user = useAuth(c);
  if (user instanceof Response) return user;
  const spaceId = c.req.param("id");
  const boardId = c.req.param("boardId");
  if (!spaceId || !boardId || !requireValidId(spaceId) || !requireValidId(boardId)) return c.json({ message: "board not found" }, 404);
  if (!(await hasPermission(user, "file.edit", { spaceId }))) return authzDenied(c);
  const body = await c.req.json<unknown>().catch(() => null);
  try {
    const transaction = normalizeBoardTransaction(body);
    if (transaction.boardId !== boardId) throw new BoardServiceError(400, "transaction boardId does not match route");
    return c.json(await applyBoardTransaction({ spaceId, actorId: user.uuid, transaction }));
  } catch (error) {
    const response = errorResponse(error);
    return c.json({ message: response.message, code: response.code }, response.status as never);
  }
});

router.post("/:boardId/playback", async (c) => {
  const user = useAuth(c);
  if (user instanceof Response) return user;
  const spaceId = c.req.param("id");
  const boardId = c.req.param("boardId");
  if (!spaceId || !boardId || !requireValidId(spaceId) || !requireValidId(boardId)) return c.json({ message: "board not found" }, 404);
  if (!(await hasPermission(user, "file.edit", { spaceId }))) return authzDenied(c);
  const body = await c.req.json<unknown>().catch(() => null);
  const parsed = BoardPlaybackCommandSchema.safeParse(body);
  if (!parsed.success) return c.json({ message: parsed.error.issues[0]?.message ?? "invalid playback command" }, 400);
  try {
    return c.json(await applyBoardPlaybackCommand({ spaceId, boardId, command: parsed.data }));
  } catch (error) {
    const response = errorResponse(error);
    return c.json({ message: response.message, code: response.code }, response.status as never);
  }
});

export default router;
