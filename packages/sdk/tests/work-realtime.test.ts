import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { WorkRoom } from "../src/apis/work-realtime.js";
import { WebsocketClient, type WebSocketLike } from "../src/websocket.js";

class FakeWebSocket implements WebSocketLike {
  static instances: FakeWebSocket[] = [];
  readonly sent: string[] = [];
  readyState = WebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = WebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  receive(payload: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(payload) }));
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code = 1000, reason = "") {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    queueMicrotask(() => this.onclose?.({ code, reason } as CloseEvent));
  }
}

const waitFor = async (predicate: () => boolean) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await delay(1);
  }
  assert.fail("condition was not met");
};

const envelope = (input: Record<string, unknown>) => ({
  id: "event-id",
  timestamp: Date.now(),
  domain: "room",
  rooms: ["room:room-1"],
  ...input,
});

const authOk = {
  id: "auth-id",
  timestamp: Date.now(),
  domain: "system",
  type: "system.auth.ok",
  payload: {
    connectionId: "connection-1",
    user: {},
    capabilities: ["realtime.room.v1"],
  },
};

test("WorkRoom publishes typed custom events and acknowledges them", async () => {
  FakeWebSocket.instances = [];
  const websocket = new WebsocketClient({
    url: "ws://localhost",
    autoReconnect: false,
    WebSocketImpl: FakeWebSocket,
    getAccessToken: () => "work-token",
  });
  const room = new WorkRoom<{ "custom.event": { value: number } }>(websocket, {
    room: {
      id: "room-1",
      code: "TEAM-ALPHA",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      maxParticipants: 16,
    },
    participantId: "participant-1",
    ticket: "ticket",
  });
  const received: number[] = [];
  room.subscribe("custom.event", (event) => received.push(event.data.value));

  const joining = room.connect();
  const socket = FakeWebSocket.instances[0];
  assert.ok(socket);
  socket.open();
  await waitFor(() => socket.sent.some((raw) => JSON.parse(raw).type === "auth"));
  socket.receive(authOk);
  await waitFor(() => socket.sent.some((raw) => JSON.parse(raw).type === "realtime.room.join"));
  const joinRequest = socket.sent.map((raw) => JSON.parse(raw)).find((item) => item.type === "realtime.room.join");
  socket.receive(envelope({
    type: "realtime.room.joined",
    requestId: joinRequest.requestId,
    payload: {
      room: {
        id: "room-1",
        code: "TEAM-ALPHA",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        maxParticipants: 16,
      },
      participantId: "participant-1",
      members: [{ participantId: "participant-1", joinedAt: new Date().toISOString(), presence: null }],
      sequence: 1,
    },
  }));
  await joining;
  assert.equal(room.state, "joined");

  const publishing = room.publish("custom.event", { value: 7 }, { clientEventId: "client-1" });
  await waitFor(() => socket.sent.some((raw) => JSON.parse(raw).type === "realtime.room.publish"));
  const publishRequest = socket.sent.map((raw) => JSON.parse(raw)).find((item) => item.type === "realtime.room.publish");
  socket.receive(envelope({
    type: "realtime.room.event",
    payload: {
      roomId: "room-1",
      sequence: 2,
      event: "custom.event",
      data: { value: 7 },
      clientEventId: "client-1",
      sender: { participantId: "participant-1" },
    },
  }));
  socket.receive(envelope({
    type: "realtime.room.request.ok",
    requestId: publishRequest.requestId,
    roomId: "room-1",
    payload: { roomId: "room-1", sequence: 2, eventId: "event-2", clientEventId: "client-1" },
  }));
  assert.deepEqual(await publishing, { eventId: "event-2", sequence: 2, clientEventId: "client-1" });
  assert.deepEqual(received, [7]);

  const leaving = room.leave();
  await waitFor(() => socket.sent.some((raw) => JSON.parse(raw).type === "realtime.room.leave"));
  const leaveRequest = socket.sent.map((raw) => JSON.parse(raw)).find((item) => item.type === "realtime.room.leave");
  socket.receive(envelope({
    type: "realtime.room.request.ok",
    requestId: leaveRequest.requestId,
    roomId: "room-1",
    payload: { roomId: "room-1" },
  }));
  await leaving;
  await websocket.disconnect();
});

test("WorkRoom releases socket listeners when a close will not reconnect", async () => {
  FakeWebSocket.instances = [];
  const websocket = new WebsocketClient({
    url: "ws://localhost",
    autoReconnect: false,
    WebSocketImpl: FakeWebSocket,
    getAccessToken: () => "work-token",
  });
  const room = new WorkRoom<{ "custom.event": { value: number } }>(websocket, {
    room: {
      id: "room-1",
      code: "TEAM-ALPHA",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      maxParticipants: 16,
    },
    participantId: "participant-1",
    ticket: "ticket",
  });
  const received: number[] = [];
  room.subscribe("custom.event", (event) => received.push(event.data.value));

  const joining = room.connect();
  const socket = FakeWebSocket.instances[0];
  assert.ok(socket);
  socket.open();
  await waitFor(() => socket.sent.some((raw) => JSON.parse(raw).type === "auth"));
  socket.receive(authOk);
  await waitFor(() => socket.sent.some((raw) => JSON.parse(raw).type === "realtime.room.join"));
  const joinRequest = socket.sent.map((raw) => JSON.parse(raw)).find((item) => item.type === "realtime.room.join");
  socket.receive(envelope({
    type: "realtime.room.joined",
    requestId: joinRequest.requestId,
    payload: {
      room: {
        id: "room-1",
        code: "TEAM-ALPHA",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        maxParticipants: 16,
      },
      participantId: "participant-1",
      members: [{ participantId: "participant-1", joinedAt: new Date().toISOString(), presence: null }],
      sequence: 1,
    },
  }));
  await joining;
  assert.equal(room.state, "joined");

  socket.close();
  await waitFor(() => room.state === "closed");

  // dispose() detached the event listener, so a late frame must not be routed.
  socket.receive(envelope({
    type: "realtime.room.event",
    payload: {
      roomId: "room-1",
      sequence: 2,
      event: "custom.event",
      data: { value: 99 },
      clientEventId: null,
      sender: { participantId: "participant-2" },
    },
  }));
  await delay(5);
  assert.deepEqual(received, [], "a disposed room must not receive further events");
});
