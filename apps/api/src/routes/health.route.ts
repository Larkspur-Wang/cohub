import { Hono } from "hono";
import { isRedisReady, GATEWAY_INBOUND_STREAM, GATEWAY_LOGS_STREAM, getStreamInfo, checkPendingMessages, INBOUND_CONSUMER_GROUP } from "../redis.js";

const router = new Hono();

router.get("/healthz", async (c) => {
  const redisReady = await isRedisReady();
  const inboundInfo = await getStreamInfo(GATEWAY_INBOUND_STREAM);
  const outboundInfo = await getStreamInfo(GATEWAY_LOGS_STREAM);
  const pendingInbound = await checkPendingMessages(GATEWAY_INBOUND_STREAM, INBOUND_CONSUMER_GROUP);
  const consumerName = `api-${process.env.POD_NAME || process.env.HOSTNAME || "unknown"}`;
  return c.json({ ok: true, redisReady, inboundInfo, outboundInfo, pendingInbound, consumer: consumerName });
});

router.get("/readyz", (c) => {
  return c.json({ ok: true });
});

export default router;
