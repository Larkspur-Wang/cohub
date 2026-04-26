import os from "node:os";
import { type Resource, resourceFromAttributes } from "@opentelemetry/resources";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import {
  SimpleSpanProcessor,
  BatchSpanProcessor,
  ConsoleSpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { IORedisInstrumentation } from "@opentelemetry/instrumentation-ioredis";
import { registerInstrumentations } from "@opentelemetry/instrumentation";

const SERVICE_NAME = "cohub-gateway";
const ENV = process.env.ENV ?? "dev";
const ARMS_ENDPOINT =
  "http://tracing-analysis-dc-usw-internal.aliyuncs.com/adapt_e4kueuvixa@b95f2fd373952c5_e4kueuvixa@53df7ad2afe8301/api/otlp/traces";

export function initTracing() {
  const resource: Resource = resourceFromAttributes({
    "service.name": SERVICE_NAME,
    "service.version": process.env.IMAGE_TAG ?? "latest",
    "deployment.environment": ENV,
    "host.name": os.hostname(),
  });

  const spanProcessors = [];

  const exporter = new OTLPTraceExporter({ url: ARMS_ENDPOINT });
  spanProcessors.push(new BatchSpanProcessor(exporter));

  if (ENV === "dev") {
    spanProcessors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
  }

  const provider = new NodeTracerProvider({
    resource,
    spanProcessors,
  });

  registerInstrumentations({
    tracerProvider: provider,
    instrumentations: [
      new HttpInstrumentation(),
      new IORedisInstrumentation(),
    ],
  });

  provider.register();
}

initTracing();
