# Runtime / Session Model

This document defines the execution model used across Cohub.

## Short version

- **Workspace** is the hosted project unit.
- **Runtime** is the outer execution instance launched from a workspace.
- **Session** is the internal LLM conversation context inside a runtime.
- **Channel** is an external communication endpoint bound to a runtime.

In short:

> Users enter a **Runtime**. Inside that runtime, Cohub manages one or more internal **Sessions**.

---

## 1. Workspace

A **Workspace** is the source project unit.

It contains the code, configuration, prompts, and files needed to run logic in the cloud.

A workspace is:
- hostable
- versionable
- shareable
- deployable

A workspace is **not** the live execution object.

---

## 2. Runtime

A **Runtime** is the outer lifecycle and execution object.

It is created from a workspace and represents the thing users actually launch, inspect, and interact with in the console.

A runtime may be:
- active
- running
- sleeping
- resumable
- stopped
- errored

A runtime owns:
- lifecycle state
- sandbox / pod execution state
- channel bindings
- one or more internal sessions

### What users do with a runtime

Users typically:
- start a runtime from a workspace
- open the runtime console
- watch output streams
- connect channels
- inspect the current session inside the runtime

---

## 3. Session

A **Session** is an internal LLM / conversation session inside a runtime.

A session is not the outer object users launch. It is the inner context object that holds conversation state.

A session owns:
- message history
- tree / branch structure
- current leaf pointer
- tool calls attached to messages
- token / cost accounting

A runtime may contain one or more sessions.

### Why session exists separately

This separation allows Cohub to model:
- long-lived runtime lifecycle
- multiple conversation contexts inside one runtime
- branching and forking message trees
- protocol adapters that map external systems into internal session state

---

## 4. Channel

A **Channel** is an external communication endpoint attached to a runtime.

Examples:
- Web console
- Discord
- Telegram
- Feishu

Channels send input into a runtime and receive output from that runtime.

When needed, a channel message may be mapped to a specific internal session through a runtime-session binding.

---

## 5. Mental model

Use this hierarchy:

```text
Workspace
  -> Runtime
       -> Session
            -> Message Tree
                 -> Tool Calls
```

And for communication:

```text
Channel <-> Runtime <-> Session
```

This means:
- a workspace is the project source
- a runtime is the running instance
- a session is the internal conversation context
- a channel is the external IO surface

---

## 6. API layering

The API should follow the same model.

### Runtime-facing APIs

Use runtime routes for outer lifecycle and console entry:

- `POST /api/runtimes`
- `GET /api/runtimes/:id`
- `GET /api/runtimes/:id/sessions`
- `GET /api/runtimes/:id/current-session`
- `GET /api/runtimes/:id/stream`

### Session-facing APIs

Use session routes for internal conversation state:

- `GET /api/sessions/:id/messages`
- `GET /api/sessions/:id/tree`
- `POST /api/sessions/:id/messages`
- `POST /api/sessions/:id/select-leaf`
- `POST /api/sessions/:id/abort`

Rule of thumb:

- if the user is entering, launching, or monitoring something, it is usually a **Runtime** concern
- if the operation is about conversation history, branching, or message state, it is usually a **Session** concern

---

## 7. UI terminology

The UI should reflect the same distinction.

Preferred wording:
- **Start Runtime**
- **Runtime Console**
- **Runtime Status**
- **Current Session**
- **Session Tree**
- **Branch from here**

Avoid using **Session** to mean the outer runtime console object.

---

## 8. Database mapping

Current schema alignment:

- `runtimes` = outer lifecycle objects
- `runtime_sessions` = internal sessions within a runtime
- `session_messages` = tree-shaped conversation history
- `session_tool_calls` = structured tool execution records
- `runtime_session_bindings` = mapping between channels and internal sessions

---

## 9. One-sentence rule

If there is ever ambiguity, use this rule:

> **Runtime is the thing you run. Session is the conversation inside it.**
