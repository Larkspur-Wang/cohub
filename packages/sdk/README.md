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
  getAccessToken: async () => localStorage.getItem("token"),
});
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
  getAccessToken: async () => localStorage.getItem("token"),
});

await ws.connect();
```

## Design principles

This SDK is intentionally built around Cohub's co-creation model:

- work with `space(...)` and `session(...)` as the primary creative surface
- send messages through `session.messages.send(...)`
- subscribe through `space.subscribe(...)` and `session.subscribe(...)`
- keep HTTP and realtime transports separate but coordinated
