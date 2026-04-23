# @neta-art/cohub-protocol

Shared protocol definitions for the Cohub agent collaboration platform.

This package provides the stable type surface used across Cohub services and client SDKs — covering spaces, checkpoints, sessions, realtime events, gateway contracts, tasks, and filesystem operations.

## Install

```bash
npm install @neta-art/cohub-protocol
```

## Subpath exports

| Subpath | Contents |
|---|---|
| `@neta-art/cohub-protocol/core` | Low-level primitives — content blocks, usage, shared types |
| `@neta-art/cohub-protocol/model` | Business records and input models — sessions, spaces, checkpoints |
| `@neta-art/cohub-protocol/realtime` | WebSocket and streaming event protocol definitions |
| `@neta-art/cohub-protocol/gateway` | Stable gateway contracts for external channels |
| `@neta-art/cohub-protocol/task` | Task scheduler and worker contracts |
| `@neta-art/cohub-protocol/fs` | Space filesystem DTOs |

## Usage

```ts
import { type ContentBlock } from "@neta-art/cohub-protocol/core";
import { type SessionInput } from "@neta-art/cohub-protocol/model";
import { type RealtimeEvent } from "@neta-art/cohub-protocol/realtime";
```
