import { Hono } from "hono";
import spacesRouter from "./spaces.route.js";
import fsRouter from "./fs.route.js";
import streamRouter from "./stream.route.js";

const router = new Hono();

router.route("/", spacesRouter);
router.route("/:id/fs", fsRouter);
router.route("/:id/stream", streamRouter);

export default router;
