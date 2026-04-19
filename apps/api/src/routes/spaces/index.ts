import { Hono } from "hono";
import spacesRouter from "./spaces.route.js";
import fsRouter from "./fs.route.js";
import streamRouter from "./stream.route.js";
import permissionsRouter from "./permissions.route.js";
import collaboratorsRouter from "./collaborators.route.js";

const router = new Hono();

router.route("/", spacesRouter);
router.route("/:id/fs", fsRouter);
router.route("/:id/stream", streamRouter);
router.route("/:id/permissions", permissionsRouter);
router.route("/:id/collaborators", collaboratorsRouter);

export default router;
