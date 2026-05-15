import { context, trace, SpanStatusCode } from "@opentelemetry/api";
import { getTracer, extractTrace } from "@cohub/tracing/propagator";
import { gatewayInboundEventSchema } from "@cohub/protocol/gateway";
import { Hono } from "hono";
import { handleInboundEvent } from "../../channels.js";
import { ensureInternalRequest } from "../../lib/middleware.js";

const tracer = getTracer("cohub-api");
const router = new Hono();

const recordSpanError = (span: ReturnType<typeof tracer.startSpan>, error: unknown) => {
  span.recordException(error instanceof Error ? error : new Error(String(error)));
  span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
};

router.post("/inbound", async (c) => {
  const forbidden = ensureInternalRequest(c);
  if (forbidden) return forbidden;

  const body = await c.req.json().catch(() => null);
  const parsed = gatewayInboundEventSchema.safeParse(body);
  if (!parsed.success) return c.json({ message: "invalid gateway inbound event", issues: parsed.error.issues }, 400);

  const event = parsed.data;
  const parentCtx = extractTrace(event as unknown as Record<string, unknown>);
  const span = tracer.startSpan("api.gateway_inbound.handle", {
    attributes: {
      "event.id": event.eventId,
      "event.type": event.eventType,
      "channel.id": event.channelId,
      provider: event.provider,
    },
  });

  try {
    await context.with(trace.setSpan(parentCtx, span), async () => {
      await handleInboundEvent(event);
    });
    return c.json({ ok: true });
  } catch (error) {
    recordSpanError(span, error);
    throw error;
  } finally {
    span.end();
  }
});

export default router;
