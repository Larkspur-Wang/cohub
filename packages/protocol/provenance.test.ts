import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COHUB_SOURCE_HEADER,
  COHUB_SOURCE_HEADER_NAMES,
  hasRequestSourceIdentity,
  isRequestSourceEmpty,
  mergeRequestSourceIntoMeta,
  normalizeRequestSource,
  parseRequestSourceFromHeaders,
  readRequestSourceFromEnv,
  requestSourceToHeaders,
  resolveRequestSourceChannel,
} from "./dist/provenance.js";

const SPACE = "11111111-1111-1111-1111-111111111111";
const SESSION = "22222222-2222-2222-2222-222222222222";

test("via-only is a valid channel source", () => {
  assert.deepEqual(normalizeRequestSource({ via: "cli" }), { via: "cli" });
  assert.equal(isRequestSourceEmpty({ via: "cli" }), false);
  assert.equal(hasRequestSourceIdentity({ via: "cli" }), false);
  assert.equal(resolveRequestSourceChannel({ via: "cli" }), "cli");
  assert.equal(resolveRequestSourceChannel(null), "public_api");
  // Control chars stripped; length capped.
  assert.deepEqual(normalizeRequestSource({ via: "cli\r\n" }), { via: "cli" });
  assert.equal(
    normalizeRequestSource({ via: `x${"a".repeat(100)}` })?.via?.length,
    64,
  );
});

test("normalizeRequestSource keeps valid fields and drops junk", () => {
  assert.deepEqual(
    normalizeRequestSource({
      spaceId: SPACE,
      sessionId: "nope",
      via: "cli",
      extra: 1,
    }),
    { spaceId: SPACE, via: "cli" },
  );
  assert.equal(normalizeRequestSource(null), null);
  assert.equal(normalizeRequestSource({}), null);
});

test("header round-trip includes via-only", () => {
  const headers = requestSourceToHeaders({ via: "web" });
  assert.deepEqual(headers, { [COHUB_SOURCE_HEADER.via]: "web" });
  const map = new Map(Object.entries(headers));
  assert.deepEqual(
    parseRequestSourceFromHeaders((name) => map.get(name) ?? null),
    { via: "web" },
  );
});

test("readRequestSourceFromEnv applies default via even without identity", () => {
  assert.deepEqual(readRequestSourceFromEnv({}, { via: "cli" }), { via: "cli" });
  assert.deepEqual(
    readRequestSourceFromEnv(
      { COHUB_SPACE_ID: SPACE, IMAGE_VERSION: "cohub-sandbox:sha-abc123" },
      { via: "cli" },
    ),
    { spaceId: SPACE, sandboxVersion: "cohub-sandbox:sha-abc123", via: "cli" },
  );
  assert.equal(readRequestSourceFromEnv({ COHUB_SPACE_ID: "not-a-uuid" }), null);
});

test("mergeRequestSourceIntoMeta stores identity only", () => {
  const withIdentity = mergeRequestSourceIntoMeta(
    { presentation: { hideCohubBar: true }, source: { spaceId: SESSION, via: "api" } },
    { spaceId: SPACE, via: "cli" },
  );
  assert.deepEqual(withIdentity, {
    presentation: { hideCohubBar: true },
    source: { spaceId: SPACE, via: "cli" },
  });

  const viaOnly = mergeRequestSourceIntoMeta(
    { presentation: { hideCohubBar: true }, source: { spaceId: SESSION } },
    { via: "cli" },
  );
  assert.deepEqual(viaOnly, { presentation: { hideCohubBar: true } });

  assert.deepEqual(
    mergeRequestSourceIntoMeta(
      { note: "ship it", source: { spaceId: SESSION } },
      { spaceId: SPACE, via: "cli" },
    ),
    { note: "ship it", source: { spaceId: SPACE, via: "cli" } },
  );
});

const CLIENT = "abc123def456abc789def012";

test("sandbox version supports legacy env fallback and prefers the Cohub env", () => {
  assert.deepEqual(
    readRequestSourceFromEnv({ IMAGE_VERSION: "cohub-sandbox:legacy" }),
    { sandboxVersion: "cohub-sandbox:legacy" },
  );
  assert.deepEqual(
    readRequestSourceFromEnv({
      COHUB_SANDBOX_VERSION: "cohub-sandbox:current",
      IMAGE_VERSION: "cohub-sandbox:legacy",
    }),
    { sandboxVersion: "cohub-sandbox:current" },
  );
  assert.deepEqual(
    readRequestSourceFromEnv({
      COHUB_SANDBOX_VERSION: "  ",
      IMAGE_VERSION: "cohub-sandbox:legacy",
    }),
    { sandboxVersion: "cohub-sandbox:legacy" },
  );
});

test("sandbox version round-trips as bounded provenance", () => {
  const headers = requestSourceToHeaders({
    sandboxVersion: "cohub-sandbox:sha-abc123",
    via: "cli",
  });
  assert.equal(
    headers[COHUB_SOURCE_HEADER.sandboxVersion],
    "cohub-sandbox:sha-abc123",
  );
  assert.deepEqual(
    parseRequestSourceFromHeaders((name) => headers[name] ?? null),
    { sandboxVersion: "cohub-sandbox:sha-abc123", via: "cli" },
  );
  assert.equal(
    normalizeRequestSource({ sandboxVersion: `v${"x".repeat(200)}` })?.sandboxVersion?.length,
    128,
  );
});

test("clientId travels as identity so UI commands can route back to a frontend", () => {
  assert.deepEqual(normalizeRequestSource({ clientId: CLIENT, via: "web" }), {
    clientId: CLIENT,
    via: "web",
  });
  // A web request with only a client id must still be recorded under meta.source,
  // otherwise the agent cannot address the tab that started the turn.
  assert.equal(hasRequestSourceIdentity({ clientId: CLIENT, via: "web" }), true);
  assert.deepEqual(
    mergeRequestSourceIntoMeta({ note: "x" }, { clientId: CLIENT, via: "web" }),
    { note: "x", source: { clientId: CLIENT, via: "web" } },
  );
});

test("clientId round-trips through headers and sandbox env", () => {
  const headers = requestSourceToHeaders({ clientId: CLIENT, via: "web" });
  assert.equal(headers[COHUB_SOURCE_HEADER.client], CLIENT);
  assert.deepEqual(
    parseRequestSourceFromHeaders((name) => headers[name] ?? null),
    { clientId: CLIENT, via: "web" },
  );
  assert.deepEqual(
    readRequestSourceFromEnv({ COHUB_SOURCE_CLIENT_ID: CLIENT }, { via: "cli" }),
    { clientId: CLIENT, via: "cli" },
  );
});

test("every emitted header is a declared name, which CORS allowlists derive from", () => {
  const headers = requestSourceToHeaders({
    spaceId: SPACE,
    sessionId: SESSION,
    turnId: SPACE,
    toolCallId: SESSION,
    clientId: CLIENT,
    sandboxVersion: "cohub-sandbox:sha-abc123",
    via: "web",
  });
  for (const name of Object.keys(headers)) {
    assert.ok(COHUB_SOURCE_HEADER_NAMES.includes(name), `${name} is not declared`);
  }
  assert.equal(Object.keys(headers).length, COHUB_SOURCE_HEADER_NAMES.length);
});

test("malformed client ids are dropped rather than trusted", () => {
  assert.equal(normalizeRequestSource({ clientId: "short" })?.clientId, undefined);
  assert.equal(normalizeRequestSource({ clientId: "has space here!!" })?.clientId, undefined);
  assert.equal(normalizeRequestSource({ clientId: "a".repeat(65) })?.clientId, undefined);
});
