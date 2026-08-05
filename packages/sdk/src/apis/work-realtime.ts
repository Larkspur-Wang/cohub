const randomId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
import type {
  RealtimeRoomDescriptor,
  RealtimeRoomEvent,
  RealtimeRoomMember,
  RealtimeRoomRequestEvent,
} from "@cohub/protocol/realtime";
import type { WorkRuntimeContext } from "../work-runtime.js";
import type { HttpTransport } from "../transport.js";
import type { WebsocketClient, WebsocketEventPayload } from "../websocket.js";

export type WorkRoomEventMap = object;

export type WorkRoomCreateInput = {
  code?: string;
  expiresInSeconds?: number;
  maxParticipants?: number;
};

export type WorkRoomAdmissionResponse = {
  room: RealtimeRoomDescriptor;
  participantId: string;
  ticket: string;
};

export type WorkRoomState = "connecting" | "joined" | "reconnecting" | "expired" | "closed";

export type WorkRoomEvent<T = unknown> = {
  id: string;
  timestamp: number;
  roomId: string;
  sequence: number;
  type: string;
  data: T;
  clientEventId: string | null;
  sender: { participantId: string };
  self: boolean;
};

export type WorkRoomPublishResult = {
  eventId: string;
  sequence: number;
  clientEventId: string | null;
};

type PendingRequest = {
  expected: Set<string>;
  resolve: (event: WebsocketEventPayload) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type EventHandler<T> = (event: WorkRoomEvent<T>) => void;
type StateHandler = (state: WorkRoomState) => void;
type MembersHandler = (members: RealtimeRoomMember[]) => void;

const requestError = (event: WebsocketEventPayload) => {
  const payload = event.payload as { code?: unknown; message?: unknown };
  return new Error(
    typeof payload.message === "string"
      ? payload.message
      : typeof payload.code === "string"
        ? payload.code
        : "room request failed",
  );
};

const isRoomEvent = (event: WebsocketEventPayload, roomId: string) => {
  if (event.domain !== "room") return false;
  const payload = event.payload as { roomId?: unknown };
  return payload.roomId === roomId || event.rooms?.includes(`room:${roomId}`);
};

export class WorkRoom<Events extends WorkRoomEventMap = WorkRoomEventMap> {
  readonly id: string;
  readonly code: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly maxParticipants: number;
  readonly participantId: string;

  private _state: WorkRoomState = "connecting";
  private _members: RealtimeRoomMember[] = [];
  private lastSequence = 0;
  private hasJoined = false;
  private explicitLeave = false;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly handlers = new Map<string, Set<EventHandler<unknown>>>();
  private readonly allHandlers = new Set<EventHandler<unknown>>();
  private readonly stateHandlers = new Set<StateHandler>();
  private readonly membersHandlers = new Set<MembersHandler>();
  private readonly outOfSyncHandlers = new Set<(expected: number, actual: number) => void>();
  private readonly offEvent: () => void;
  private readonly offOpen: () => void;
  private readonly offClose: () => void;
  private readonly offReconnecting: () => void;

  constructor(
    private readonly websocket: WebsocketClient,
    private readonly admission: WorkRoomAdmissionResponse,
  ) {
    this.id = admission.room.id;
    this.code = admission.room.code;
    this.createdAt = admission.room.createdAt;
    this.expiresAt = admission.room.expiresAt;
    this.maxParticipants = admission.room.maxParticipants;
    this.participantId = admission.participantId;

    this.offEvent = websocket.on("event", (event) => this.handleEvent(event));
    this.offOpen = websocket.on("open", () => {
      if (!this.hasJoined || this.explicitLeave || this._state === "expired" || this._state === "closed") return;
      void this.rejoin();
    });
    this.offReconnecting = websocket.on("reconnecting", () => {
      if (this.hasJoined && !this.explicitLeave) this.setState("reconnecting");
    });
    this.offClose = websocket.on("close", ({ willReconnect }) => {
      this.rejectPending(new Error("room connection closed"));
      if (this.explicitLeave || !willReconnect) {
        if (this._state !== "expired") this.setState("closed");
        // Nothing will reopen this room, so stop holding socket listeners and
        // the expiry timer, which can otherwise sit for the room's full 24h life.
        this.hasJoined = false;
        this.dispose();
      } else if (this.hasJoined) {
        this.setState("reconnecting");
      }
    });

    const delay = Math.max(0, Date.parse(this.expiresAt) - Date.now());
    this.expiryTimer = setTimeout(() => this.expire(), Math.min(delay, 2_147_000_000));
  }

  get state() {
    return this._state;
  }

  get members() {
    return this._members.slice();
  }

  async connect() {
    await this.joinOverWebsocket(false);
    return this;
  }

  subscribe<K extends Extract<keyof Events, string>>(type: K, handler: EventHandler<Events[K]>) {
    const handlers = this.handlers.get(type) ?? new Set<EventHandler<unknown>>();
    handlers.add(handler as EventHandler<unknown>);
    this.handlers.set(type, handlers);
    return () => handlers.delete(handler as EventHandler<unknown>);
  }

  subscribeAll(handler: (event: WorkRoomEvent<unknown>) => void) {
    this.allHandlers.add(handler as EventHandler<unknown>);
    return () => this.allHandlers.delete(handler as EventHandler<unknown>);
  }

  onStateChange(handler: StateHandler) {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  onMembersChanged(handler: MembersHandler) {
    this.membersHandlers.add(handler);
    return () => this.membersHandlers.delete(handler);
  }

  onOutOfSync(handler: (expected: number, actual: number) => void) {
    this.outOfSyncHandlers.add(handler);
    return () => this.outOfSyncHandlers.delete(handler);
  }

  async publish<K extends Extract<keyof Events, string>>(type: K, data: Events[K], options?: { clientEventId?: string }) {
    this.assertJoined();
    const requestId = randomId();
    const response = await this.request(requestId, new Set(["realtime.room.request.ok"]), () =>
      this.websocket.publishRealtimeRoom({
        roomId: this.id,
        event: type,
        data,
        clientEventId: options?.clientEventId,
        requestId,
      }),
    );
    const payload = response.payload as RealtimeRoomRequestEvent["payload"];
    return {
      eventId: typeof payload.eventId === "string" ? payload.eventId : response.id,
      sequence: typeof payload.sequence === "number" ? payload.sequence : 0,
      clientEventId: typeof payload.clientEventId === "string" ? payload.clientEventId : null,
    } satisfies WorkRoomPublishResult;
  }

  async setPresence(presence: Record<string, unknown> | null) {
    this.assertJoined();
    const requestId = randomId();
    await this.request(requestId, new Set(["realtime.room.request.ok"]), () =>
      this.websocket.updateRealtimeRoomPresence({ roomId: this.id, presence, requestId }),
    );
  }

  async leave() {
    if (this.explicitLeave || this._state === "closed" || this._state === "expired") return;
    this.explicitLeave = true;
    try {
      if (this.hasJoined && this.websocket.state === "open") {
        const requestId = randomId();
        await this.request(requestId, new Set(["realtime.room.request.ok"]), () =>
          this.websocket.leaveRealtimeRoom({ roomId: this.id, requestId }),
        );
      }
    } finally {
      this.hasJoined = false;
      this.setState("closed");
      this.dispose();
    }
  }

  private async rejoin() {
    if (this.explicitLeave || this._state === "expired" || this._state === "closed") return;
    try {
      await this.joinOverWebsocket(true);
    } catch (error) {
      if (this.state === "expired") return;
      this.setState("closed");
      this.dispose();
      console.warn("[Cohub WorkRoom] failed to rejoin room", error);
    }
  }

  private async joinOverWebsocket(isReconnect: boolean) {
    if (!this.websocket.supportsCapability("realtime.room.v1") && this.websocket.state === "open") {
      throw new Error("Realtime rooms are not supported by the Gateway");
    }
    this.setState(isReconnect ? "reconnecting" : "connecting");
    const requestId = randomId();
    const response = await this.request(requestId, new Set(["realtime.room.joined"]), () =>
      this.websocket.joinRealtimeRoom({ roomId: this.id, ticket: this.admission.ticket, requestId }),
    );
    const payload = response.payload as {
      participantId?: unknown;
      members?: unknown;
      sequence?: unknown;
    };
    if (payload.participantId !== this.participantId || !Array.isArray(payload.members)) {
      throw new Error("invalid room join response");
    }
    this._members = payload.members as RealtimeRoomMember[];
    this.lastSequence = typeof payload.sequence === "number" ? payload.sequence : 0;
    this.hasJoined = true;
    this.setState("joined");
    this.notifyMembers();
  }

  private request(requestId: string, expected: Set<string>, send: () => Promise<void>) {
    return new Promise<WebsocketEventPayload>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("room request timed out"));
      }, 20_000);
      this.pending.set(requestId, { expected, resolve, reject, timer });
      void send().catch((error) => {
        this.pending.delete(requestId);
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  private handleEvent(event: WebsocketEventPayload) {
    if (!isRoomEvent(event, this.id)) {
      if (event.requestId && this.pending.has(event.requestId) && event.type === "system.request.error") {
        const pending = this.pending.get(event.requestId);
        if (pending) {
          this.pending.delete(event.requestId);
          clearTimeout(pending.timer);
          pending.reject(requestError(event));
        }
      }
      return;
    }

    if (event.requestId && this.pending.has(event.requestId)) {
      const pending = this.pending.get(event.requestId);
      if (pending?.expected.has(event.type)) {
        this.pending.delete(event.requestId);
        clearTimeout(pending.timer);
        pending.resolve(event);
      }
    }

    const payload = event.payload as Record<string, unknown>;
    const sequence = typeof payload.sequence === "number" ? payload.sequence : null;
    if (sequence !== null) this.observeSequence(sequence);

    if (event.type === "realtime.room.member.joined" || event.type === "realtime.room.member.left" || event.type === "realtime.room.presence.updated") {
      const member = payload.member as RealtimeRoomMember | undefined;
      if (member?.participantId) {
        const members = new Map(this._members.map((item) => [item.participantId, item]));
        if (event.type === "realtime.room.member.left") members.delete(member.participantId);
        else members.set(member.participantId, member);
        this._members = [...members.values()];
        this.notifyMembers();
      }
      return;
    }

    if (event.type === "realtime.room.closed") {
      this.hasJoined = false;
      if (payload.reason === "expired") this.setState("expired");
      else this.setState("closed");
      this.dispose();
      return;
    }

    if (event.type !== "realtime.room.event") return;
    const roomEvent = event as RealtimeRoomEvent;
    const roomPayload = roomEvent.payload;
    const item: WorkRoomEvent<unknown> = {
      id: roomEvent.id,
      timestamp: roomEvent.timestamp,
      roomId: roomPayload.roomId,
      sequence: roomPayload.sequence,
      type: roomPayload.event,
      data: roomPayload.data,
      clientEventId: roomPayload.clientEventId,
      sender: roomPayload.sender,
      self: roomPayload.sender.participantId === this.participantId,
    };
    this.handlers.get(item.type)?.forEach((handler) => {
      handler(item);
    });
    this.allHandlers.forEach((handler) => {
      handler(item);
    });
  }

  private observeSequence(sequence: number) {
    if (this.lastSequence > 0 && sequence > this.lastSequence + 1) {
      for (const handler of this.outOfSyncHandlers) handler(this.lastSequence + 1, sequence);
    }
    if (sequence > this.lastSequence) this.lastSequence = sequence;
  }

  private assertJoined() {
    if (this._state !== "joined" || !this.hasJoined) throw new Error("room is not joined");
  }

  private setState(state: WorkRoomState) {
    if (this._state === state) return;
    this._state = state;
    for (const handler of this.stateHandlers) handler(state);
  }

  private notifyMembers() {
    const members = this.members;
    for (const handler of this.membersHandlers) handler(members);
  }

  private rejectPending(error: Error) {
    for (const [requestId, pending] of this.pending) {
      this.pending.delete(requestId);
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }

  private expire() {
    if (this.explicitLeave || this._state === "closed" || this._state === "expired") return;
    this.hasJoined = false;
    this.setState("expired");
    this.rejectPending(new Error("room expired"));
    this.dispose();
  }

  private dispose() {
    this.offEvent();
    this.offOpen();
    this.offClose();
    this.offReconnecting();
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
  }
}

export class WorkRealtimeApi {
  constructor(
    private readonly transport: HttpTransport,
    private readonly websocket: WebsocketClient,
    private readonly getContext: () => Promise<WorkRuntimeContext | null>,
  ) {}

  async createRoom<Events extends WorkRoomEventMap = WorkRoomEventMap>(input: WorkRoomCreateInput = {}) {
    const admission = await this.transport.request<WorkRoomAdmissionResponse>(
      `/api/works/${encodeURIComponent(await this.requireWorkId())}/realtime/rooms`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) },
    );
    return this.openRoom<Events>(admission);
  }

  async joinRoom<Events extends WorkRoomEventMap = WorkRoomEventMap>(input: { code: string }) {
    const admission = await this.transport.request<WorkRoomAdmissionResponse>(
      `/api/works/${encodeURIComponent(await this.requireWorkId())}/realtime/rooms/join`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) },
    );
    return this.openRoom<Events>(admission);
  }

  private async requireWorkId() {
    const context = await this.getContext();
    if (!context?.work?.id) throw new Error("Work context is unavailable — not running inside a published Work runtime.");
    return context.work.id;
  }

  private async openRoom<Events extends WorkRoomEventMap>(admission: WorkRoomAdmissionResponse) {
    const room = new WorkRoom<Events>(this.websocket, admission);
    try {
      await room.connect();
      return room;
    } catch (error) {
      await room.leave().catch(() => undefined);
      throw error;
    }
  }
}
