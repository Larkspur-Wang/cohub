import os from "node:os";
import { type Resource, resourceFromAttributes } from "@opentelemetry/resources";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-base";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
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

function envFlag(name: string, defaultValue = false) {
  const value = process.env[name]?.trim().toLowerCase();
  if (value == null || value === "") return defaultValue;
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function envNumber(name: string, defaultValue: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : defaultValue;
}

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

  // Report to Alibaba Cloud ARMS. Batch exporting keeps tracing off the request hot path.
  const exporter = new OTLPTraceExporter({ url: ARMS_ENDPOINT });
  spanProcessors.push(new BatchSpanProcessor(exporter));

  // Console span export is intentionally opt-in. It is very expensive for streaming
  // agent workloads because every span is serialized and written to stdout.
  if (envFlag("OTEL_CONSOLE_EXPORTER")) {
    spanProcessors.push(new BatchSpanProcessor(new ConsoleSpanExporter(), {
      maxQueueSize: 256,
      maxExportBatchSize: 32,
      scheduledDelayMillis: 1000,
    }));
  }

  if (options.extraSpanProcessors) {
    spanProcessors.push(...options.extraSpanProcessors);
  }

  const provider = new NodeTracerProvider({
    resource,
    sampler: new TraceIdRatioBasedSampler(Math.min(1, Math.max(0, envNumber("OTEL_TRACE_SAMPLE_RATIO", 1)))),
    spanProcessors,
  });

  if (envFlag("OTEL_AUTO_INSTRUMENTATION", true)) {
    registerInstrumentations({
      tracerProvider: provider,
      instrumentations: [
        new HttpInstrumentation(),
        new UndiciInstrumentation(),
        new IORedisInstrumentation(),
      ],
    });
  }

  provider.register();
}
