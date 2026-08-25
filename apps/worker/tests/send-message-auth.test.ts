import assert from "node:assert/strict";
import { test } from "node:test";
import { UnrecoverableError } from "bullmq";
import type { PromptAuthContext } from "@cohub/core/sessions";
import type { Permission } from "@cohub/core/permissions";
import { sanitizeTaskPromptAuth, type LiveScopeResolver } from "../src/tasks/send-message-auth.js";

const INPUT = { spaceId: "space-1", userId: "user-1", promptPermission: "session.prompt.fullaccess" as Permission };

function delegatedAuth(overrides: Partial<Extract<PromptAuthContext, { type: "delegated_prompt" }>> = {}) {
  return {
    type: "delegated_prompt",
    source: "app_session",
    actorUserId: "user-1",
    appId: "app-1",
    spaceId: "space-1",
    scopes: ["session.prompt.fullaccess", "file.view"],
    appScopes: [],
    viewerScopes: ["session.prompt.fullaccess", "file.view"],
    delegatedAt: new Date().toISOString(),
    exp: Math.floor(Date.now() / 1000) + 3600,
    appViewerGrantId: "grant-1",
    ...overrides,
  } satisfies PromptAuthContext;
}

/** The payload snapshot is untrusted; only what the resolver returns counts. */
const resolverWith = (appScopes: Permission[], viewerScopes: Permission[]): LiveScopeResolver =>
  async () => ({ appScopes, viewerScopes });

test("no auth is a plain user task and passes through", async () => {
  assert.equal(await sanitizeTaskPromptAuth(null, INPUT, resolverWith([], [])), null);
  assert.equal(await sanitizeTaskPromptAuth(undefined, INPUT, resolverWith([], [])), null);
});

test("auth that does not match this task aborts instead of degrading", async () => {
  const cases: PromptAuthContext[] = [
    delegatedAuth({ spaceId: "space-other" }),
    delegatedAuth({ actorUserId: "user-2" }),
    delegatedAuth({ source: "cron-editor" }),
    delegatedAuth({ appId: undefined as unknown as string }),
    { ...delegatedAuth(), type: "app_session" } as unknown as PromptAuthContext,
  ];
  for (const auth of cases) {
    await assert.rejects(sanitizeTaskPromptAuth(auth, INPUT, resolverWith([], [])), UnrecoverableError);
  }
});

test("forged snapshot scopes are ignored — only server-resolved scopes count", async () => {
  // A cron payload edited to claim arbitrary viewer scopes without a grant
  // reference: the resolver says the app and grant actually allow nothing.
  const forged = delegatedAuth({
    appViewerGrantId: null,
    appScopes: ["member.manage", "space.edit"],
    viewerScopes: ["session.prompt.fullaccess", "member.manage"],
    scopes: ["session.prompt.fullaccess", "member.manage"],
  });
  await assert.rejects(
    sanitizeTaskPromptAuth(forged, INPUT, resolverWith([], [])),
    UnrecoverableError,
  );
});

test("an expired submission snapshot no longer matters — the live reference does", async () => {
  const expiredSnapshot = delegatedAuth({ exp: Math.floor(Date.now() / 1000) - 3600 });
  const sanitized = await sanitizeTaskPromptAuth(
    expiredSnapshot,
    INPUT,
    resolverWith([], ["session.prompt.fullaccess"]),
  );
  assert.ok(sanitized && sanitized.type === "delegated_prompt");
  // The rebuilt context is fresh as of execution time.
  assert.ok(sanitized.exp > Math.floor(Date.now() / 1000));
  assert.deepEqual(sanitized.scopes, ["session.prompt.fullaccess"]);
});

test("a revoked grant aborts when app scopes do not cover the prompt", async () => {
  await assert.rejects(
    sanitizeTaskPromptAuth(delegatedAuth(), INPUT, resolverWith([], [])),
    UnrecoverableError,
  );
});

test("publisher app scopes keep the task running when the grant dies", async () => {
  const sanitized = await sanitizeTaskPromptAuth(
    delegatedAuth(),
    INPUT,
    resolverWith(["session.prompt.fullaccess"], []),
  );
  assert.ok(sanitized && sanitized.type === "delegated_prompt");
  assert.deepEqual(sanitized.viewerScopes, []);
  assert.deepEqual(sanitized.scopes, ["session.prompt.fullaccess"]);
});

test("a role downgrade trims scopes but keeps a still-covered prompt running", async () => {
  const sanitized = await sanitizeTaskPromptAuth(
    delegatedAuth(),
    INPUT,
    resolverWith([], ["session.prompt.fullaccess", "file.view"]),
  );
  assert.ok(sanitized && sanitized.type === "delegated_prompt");
  assert.deepEqual(sanitized.viewerScopes, ["session.prompt.fullaccess", "file.view"]);
  assert.deepEqual(sanitized.scopes, ["session.prompt.fullaccess", "file.view"]);
});

test("losing the prompt permission itself aborts the task", async () => {
  await assert.rejects(
    sanitizeTaskPromptAuth(delegatedAuth(), INPUT, resolverWith([], ["file.view"])),
    UnrecoverableError,
  );
});

test("permission implications keep a read-only prompt alive under full access", async () => {
  const input = { ...INPUT, promptPermission: "session.prompt.readonly" as Permission };
  const sanitized = await sanitizeTaskPromptAuth(
    delegatedAuth(),
    input,
    resolverWith([], ["session.prompt.fullaccess"]),
  );
  assert.ok(sanitized);
});
