# @neta-art/cohub

Cohub SDK for interacting with spaces, sessions, checkpoints, and realtime agent collaboration.

## Install

```bash
npm install @neta-art/cohub @neta-art/cohub-protocol
```

## Quick start

```ts
import { createCohubClient } from "@neta-art/cohub";

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

## Session subscriptions

```ts
const stop = session.subscribe({
  progress(event) {
    console.log("progress", event.payload);
  },
  final(event) {
    console.log("final", event.payload);
  },
  error(event) {
    console.error("error", event.payload);
  },
  persisted(event) {
    console.log("persisted", event.payload);
  },
});

// later
stop();
```

You can also listen with business-oriented event names:

```ts
session.on("turn.final", (event) => {
  console.log(event.payload);
});

space.on("message.persisted", (event) => {
  console.log(event.payload);
});
```

Supported business event names:

- `turn.progress`
- `turn.final`
- `turn.error`
- `message.persisted`

## HTTP-only usage

If you only want HTTP transport, use the dedicated entry:

```ts
import { createHttpClient } from "@neta-art/cohub/http";

const http = createHttpClient({
  baseUrl: "https://api.example.com",
  getAccessToken: async () => localStorage.getItem("token"),
});

const spaces = await http.spaces.list();
```

Note: realtime methods like `space.subscribe(...)` or `session.subscribe(...)` require the main client with websocket configuration.

## Low-level websocket usage

If you need direct realtime transport access, use the websocket entry:

```ts
import { createWebsocketClient } from "@neta-art/cohub/websocket";

const ws = createWebsocketClient({
  url: "https://gateway.example.com",
  getAccessToken: async () => localStorage.getItem("token"),
});

await ws.connect();
```

## Design principles

This SDK is intentionally built around Cohub's co-creation model:

- work with `space(...)` and `session(...)` as the primary creative surface
- send messages through `session.messages.send(...)`
- subscribe through `space.subscribe(...)` and `session.subscribe(...)`
- keep protocol details behind the SDK surface

## Publish checklist

Before publishing:

1. build the protocol package: `pnpm --filter @neta-art/cohub-protocol build`
2. build this package: `pnpm --filter @neta-art/cohub build`
3. typecheck the protocol package: `pnpm --filter @neta-art/cohub-protocol typecheck`
4. typecheck this package: `pnpm --filter @neta-art/cohub typecheck`
5. verify consuming apps still typecheck
6. verify `dist/` contains `index`, `http`, and `websocket` outputs
