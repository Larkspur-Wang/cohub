import { Hono } from "hono";
import internalGatewayRouter from "./gateway.route.js";
import internalCanvasRouter from "./canvas.route.js";
import internalSpaceEventsRouter from "./space-events.route.js";
import internalSpacesRouter from "./spaces.route.js";

const router = new Hono();

router.route("/gateway", internalGatewayRouter);
router.route("/space-events", internalSpaceEventsRouter);
router.route("/spaces", internalSpacesRouter);
router.route("/canvas", internalCanvasRouter);

export default router;
