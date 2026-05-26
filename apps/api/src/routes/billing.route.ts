import { Hono } from "hono";
import { billingOperations, COHUB_BILLING_TOKEN_TYPES } from "../billing/index.js";
import { useAuth } from "../lib/middleware.js";

const router = new Hono();

router.get("/credits", async (c) => {
  const user = useAuth(c);
  const requestedTokenType = c.req.query("tokenType")?.trim();
  if (requestedTokenType && requestedTokenType !== COHUB_BILLING_TOKEN_TYPES.usdMicroCent) {
    return c.json({ message: "unsupported billing token type" }, 400);
  }
  const tokenType = COHUB_BILLING_TOKEN_TYPES.usdMicroCent;
  const credit = await billingOperations.getCreditStatus({
    userId: user.uuid,
    tokenType,
  });
  return c.json({ credit });
});

export default router;
