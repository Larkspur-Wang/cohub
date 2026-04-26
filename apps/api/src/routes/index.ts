import { Hono } from "hono";
import healthRouter from "./health.route.js";
import modelsRouter from "./models.route.js";
import meRouter from "./me.route.js";
import channelsRouter from "./channels.route.js";
import userRouter from "./user.route.js";
import spacesRouter from "./spaces/index.js";
import sessionsRouter from "./sessions.route.js";
import sessionAccessRouter from "./session-access.route.js";
import internalRouter from "./internal/index.js";
import cronJobsRouter from "./cron-jobs.route.js";
import tasksRouter from "./tasks.route.js";
import trendingRouter from "./trending.route.js";
import promptsRouter from "./prompts.route.js";

const router = new Hono();

router.route("/", healthRouter);
router.route("/api/models", modelsRouter);
router.route("/api/prompts", promptsRouter);
router.route("/api/me", meRouter);
router.route("/api/channels", channelsRouter);
router.route("/api/user", userRouter);
router.route("/api/spaces", spacesRouter);
router.route("/api/sessions", sessionsRouter);
router.route("/api/sessions", sessionAccessRouter);
router.route("/api/cron-jobs", cronJobsRouter);
router.route("/api/tasks", tasksRouter);
router.route("/api/trending", trendingRouter);
router.route("/internal", internalRouter);

export default router;
