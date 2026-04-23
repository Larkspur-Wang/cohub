import { Hono } from "hono";
import spacesRouter from "./spaces.route.js";
import fsRouter from "./fs.route.js";
import membersRouter from "./members.route.js";
import accessRouter from "./access.route.js";

const router = new Hono();

router.route("/", spacesRouter);
router.route("/:id/fs", fsRouter);
router.route("/:id/members", membersRouter);
router.route("/:id/access", accessRouter);

export default router;
