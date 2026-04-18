import { Hono } from "hono";
import internalSpacesRouter from "./spaces.route.js";

const router = new Hono();

router.route("/spaces", internalSpacesRouter);

export default router;
