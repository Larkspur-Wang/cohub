# @neta-art/cohub

Cohub SDK for interacting with spaces, sessions, checkpoints, and realtime agent collaboration.

## Install

```bash
npm install @neta-art/cohub
```

## Quick start

```ts
import { createCohubClient } from "@neta-art/cohub";
import type { ContentBlock } from "@neta-art/cohub";

const client = createCohubClient({
  getAccessToken: async () => localStorage.getItem("token"),
});

const content: ContentBlock[] = [{ type: "text", text: "Hello" }];
```

The SDK connects to production by default:

- API: `https://api.cohub.run`
- WebSocket: `wss://gateway.cohub.run/ws`

Use development with `ENV=dev` in Node.js:

```bash
ENV=dev node app.js
```

Or select it explicitly in code:

```ts
const client = createCohubClient({
  env: "dev",
  getAccessToken: async () => localStorage.getItem("token"),
});
```

Development uses:

- API: `https://api-dev.cohub.run`
- WebSocket: `wss://gateway-dev.cohub.run/ws`

Custom endpoints are still supported when needed:

```ts
const client = createCohubClient({
  baseUrl: "https://api.example.com",
  getAccessToken: async () => localStorage.getItem("token"),
  websocket: {
    url: "https://gateway.example.com",
  },
});
```

## Spaces and sessions

A **Space** is a live, isolated working environment where users and agents create together.

```ts
const created = await client.spaces.create({ name: "Demo" });
const space = client.space(created.space.id);

const sessionResult = await space.sessions.create({ title: "Planning" });
const session = space.session(sessionResult.session.id);

await session.messages.send({
  content: [{ type: "text", text: "Help me plan the next steps" }],
});
```

## Boards

Use `space.boards` for collection operations and bind an ID with
`space.board(boardId)` for entity operations:

```ts
const created = await space.boards.create({
  path: "boards/plan.board",
  title: "Plan",
  nodes: [],
});

const board = space.board(created.board.id);
// Equivalent: space.boards.byId(created.board.id)

const snapshot = await board.inspect({
  include: ["nodes", "effects", "sequences", "clips", "playback"],
});

await board.apply({
  txId: crypto.randomUUID(),
  baseVersion: snapshot.board.version,
  operations: [
    { type: "board.patch", payload: { patch: { title: "Updated plan" } } },
  ],
});
```

A bound `BoardClient` injects its `boardId` into validation and transaction
requests. Realtime subscriptions are also scoped to that Board:

```ts
const stop = board.subscribe({
  transaction(event) {
    console.log("version", event.payload.version);
  },
  playback(event) {
    console.log("playback", event.payload.status);
  },
});

stop();
```

Import timeline compilation and extension registry helpers from the lightweight
Board entry point:

```ts
import {
  clip,
  compileSequence,
  createBoardExtensionRegistry,
  timeline,
} from "@neta-art/cohub/board";
```

## Session subscriptions

```ts
const stop = session.subscribe({
  progress(event) {
    console.log("progress", event.payload);
  },
  finalized(event) {
    console.log("done", event.payload);
  },
});

stop();
```

## Works and the Work runtime

A **Work** is a published, shareable web page hosted by Cohub. When a viewer
opens a Work, it runs inside a Cohub-managed runtime that provides short-lived
access tokens — no API keys required.

Three runtime-only APIs are available **exclusively inside a published Work**:

- `client.context()` — returns Work identity, Space identity, and current
  permission scopes. Returns `null` outside a Work runtime.
- `client.auth.request({ scopes, reason })` — shows the viewer a consent dialog
  and caches a token with the approved scopes.
- `client.work.commerce.*` — entitlement checks, credit consumption,
  purchases.

### Quick start (inside a Work)

```ts
// Browsers don't inject ENV — pass it explicitly.
const client = createCohubClient({ env: "prod" });

const ctx = await client.context();
if (!ctx?.space?.id) throw new Error("Not inside a published Work.");

const space = client.space(ctx.space.id);

// Request viewer scopes from a user gesture (button click)
await client.auth.request({
  scopes: ["session.prompt.fullaccess", "generation.create"],
  reason: "This Work needs to send prompts and generate images.",
});
```

### The scope model (critical)

Work permissions come in **two disjoint sets**:

- **Work scopes** (read, no consent): `space.view`, `session.view`,
  `file.view`, `taskrun.view` — granted at publish time.
- **Viewer scopes** (action, consent-required): `session.prompt.fullaccess`,
  `generation.create`, `user.space.list`, `user.session.list`,
  `user.usage.read` — approved per-viewer via `auth.request()`.

> **Read operations need work scopes. Action operations need viewer scopes.
They never substitute for each other.** For example, `session.prompt.fullaccess`
lets you send a prompt but does NOT let you read the reply — that needs
`session.view` (a work scope). Similarly, `generation.create` lets you create
a generation task, but polling its result needs `taskrun.view` (a work scope).

For the complete API-to-scope mapping, initialization recipe, capability
recipes, a full working example, and a pitfalls checklist, see the
**[Work Runtime Guide](./docs/work-runtime-guide.md)**.
