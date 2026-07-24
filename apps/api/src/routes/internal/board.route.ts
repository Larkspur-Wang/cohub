import { Hono } from "hono";
import { applyBoardTransaction, type BoardSemanticOp } from "../../board-service.js";
import { ensureInternalRequest, requireValidId, type AuthUser } from "../../lib/middleware.js";
import { hasPermission } from "../../permissions.js";

const router = new Hono();

router.post("/:spaceId/:documentId/tx", async (c) => {
  const forbidden = ensureInternalRequest(c);
  if (forbidden) return forbidden;
  const spaceId = c.req.param("spaceId");
  const documentId = c.req.param("documentId");
  if (!requireValidId(spaceId) || !requireValidId(documentId)) return c.json({ message: "board not found" }, 404);
  const body = await c.req.json<{
    actorId?: string;
    txId?: string;
    baseVersion?: number | null;
    clientId?: string | null;
    undoGroupId?: string | null;
    ops?: BoardSemanticOp[];
  }>().catch(() => null);
  if (!body?.actorId || !body.txId || !Array.isArray(body.ops)) return c.json({ message: "invalid board transaction" }, 400);
  try {
    const actor = { uuid: body.actorId } as AuthUser;
    if (!(await hasPermission(actor, "file.edit", { spaceId }))) return c.json({ message: "forbidden" }, 403);
    const result = await applyBoardTransaction({
      spaceId,
      documentId,
      actorId: body.actorId,
      txId: body.txId,
      baseVersion: body.baseVersion ?? null,
      clientId: body.clientId ?? null,
      undoGroupId: body.undoGroupId ?? null,
      ops: body.ops,
    });
    return c.json(result);
  } catch (error) {
    const status = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : 500;
    const message = error instanceof Error ? error.message : "Board operation failed";
    return c.json({ message }, status as never);
  }
});

export default router;
