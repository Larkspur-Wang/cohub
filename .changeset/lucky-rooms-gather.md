---
"@neta-art/cohub": minor
---

Add realtime rooms to the Work runtime. Works can create or join a code-scoped room through `client.work.realtime` and exchange generic JSON events over the existing WebSocket, with member presence, room-scoped sequencing, and short-lived admission tickets. High-frequency senders can use `room.send` to skip the per-event ack. Every connection is its own participant by default, and members carry an opaque `userKey` so an application can group a viewer's connections; a room created with `seatPerUser` gives each viewer a single seat instead.
