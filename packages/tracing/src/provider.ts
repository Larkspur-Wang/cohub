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

const ARMS_ENDPOINT =
  "http://tracing-analysis-dc-usw-internal.aliyuncs.com/adapt_e4kueuvixa@b95f2fd373952c5_e4kueuvixa@53df7ad2afe8301/api/otlp/traces";

export type TracingOptions = {
  serviceName: string;
  serviceVersion?: string;
  environment?: string;
  /** Additional span processors to register (e.g. for testing). */
  extraSpanProcessors?: import("@opentelemetry/sdk-trace-base").SpanProcessor[];
};

/**
 * Initialize OpenTelemetry tracing for a service.
 * Call this as early as possible (before any other imports that make network calls).
 */
export function initTracing(options: TracingOptions) {
  const ENV = options.environment ?? process.env.ENV ?? "dev";
  const resource: Resource = resourceFromAttributes({
    "service.name": options.serviceName,
    "service.version": options.serviceVersion ?? process.env.IMAGE_TAG ?? "latest",
    "deployment.environment": ENV,
    "host.name": os.hostname(),
  });

  const spanProcessors: import("@opentelemetry/sdk-trace-base").SpanProcessor[] = [];

  // Report to Alibaba Cloud ARMS
  const exporter = new OTLPTraceExporter({ url: ARMS_ENDPOINT });
  spanProcessors.push(new BatchSpanProcessor(exporter));

  // Print to console in dev for debugging
  if (ENV === "dev") {
    spanProcessors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
  }

  if (options.extraSpanProcessors) {
    spanProcessors.push(...options.extraSpanProcessors);
  }

  const provider = new NodeTracerProvider({
    resource,
    spanProcessors,
  });

  // Auto-instrument: outbound HTTP + Redis
  registerInstrumentations({
    tracerProvider: provider,
    instrumentations: [
      new HttpInstrumentation(),
      new IORedisInstrumentation(),
    ],
  });

  provider.register();
}
