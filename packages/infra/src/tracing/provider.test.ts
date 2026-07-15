import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveOtlpTracesEndpoint } from "./provider.js";

test("resolveOtlpTracesEndpoint returns undefined without configuration", () => {
  assert.equal(resolveOtlpTracesEndpoint({}), undefined);
});

test("resolveOtlpTracesEndpoint prefers the traces-specific endpoint", () => {
  assert.equal(
    resolveOtlpTracesEndpoint({
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://collector.example/v1/traces/",
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example",
    }),
    "https://collector.example/v1/traces",
  );
});

test("resolveOtlpTracesEndpoint appends /v1/traces to a base endpoint", () => {
  assert.equal(
    resolveOtlpTracesEndpoint({
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example/",
    }),
    "https://collector.example/v1/traces",
  );
});

test("resolveOtlpTracesEndpoint keeps an already complete base endpoint", () => {
  assert.equal(
    resolveOtlpTracesEndpoint({
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example/v1/traces",
    }),
    "https://collector.example/v1/traces",
  );
});
