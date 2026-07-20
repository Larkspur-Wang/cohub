# Space Hooks (MVP)

Space Hooks let a Space declare asynchronous automation with files under:

```text
.cohub/hooks/*.yml
.cohub/hooks/*.yaml
.cohub/hooks/*.json
```

## Declaration

One file is one hook. The file path is the identity.
Exactly one of `run` or `prompt` is required.

```yaml
schema: cohub.space-hook.v1

on:
  event: space.fs.changed
  paths:
    - src/**
  ignore:
    - src/generated/**

env:
  REVIEW_SCOPE: public

run: |
  echo "$REVIEW_SCOPE"
  npm test
```

Prompt action:

```yaml
schema: cohub.space-hook.v1

on:
  event: checkpoint.created

env:
  REVIEW_SCOPE: public

prompt:
  text: summarize the new checkpoint and suggest next steps
  intent: followup
```

Top-level `env` is shared by both `run` and `prompt`.
Legacy `prompt.env` is still accepted as a fallback.
User env cannot override system keys (`COHUB_*`, etc.).

Supported events:

- `space.fs.changed`
- `space.workspace.ready`
- `session.turn.finalized`
- `checkpoint.created`

## Trigger

Every service fans out locally — no HTTP hop, no second PubSub consumer:

```text
domain event (any service)
  ├─ publish realtime envelope  → UI
  └─ enqueue space_hook task    → cohub-tasks (best-effort)
```

Services that trigger directly:

| Service | Realtime | Hook enqueue |
|---|---|---|
| API | local Redis publish | local BullMQ |
| Worker | local Redis publish | local BullMQ |
| Agent | local Redis publish | local BullMQ |
| Gateway | local Redis publish | local BullMQ |

## Execution

All rigorous work happens inside the `space_hook` job:

```text
space_hook task
  → resolve Space owner
  → invalidate/load hook cache
  → match .cohub/hooks/*
  → run    → existing run_command chain
  → prompt → existing session prompt chain
```

Execution and billing use the Space owner:

```text
task_runs.type = space_hook
task_runs.userUuid = space.userUuid
queue = cohub-tasks
```

## Hook cache

Worker loads hooks from the Space workspace PVC:

```text
$SPACE_STORAGE_ROOT/<spaceId>/workspace/.cohub/hooks
```

Parsed definitions are cached in Redis:

```text
key: cohub:space-hooks:v1:<spaceId>
ttl: 5 minutes
```

If an `space.fs.changed` event touches `.cohub/hooks/**`, the cache is invalidated before the next match.

## Hook context env

`run` and `prompt` share the same curated env. Empty values are omitted.

Always present:

```text
COHUB_HOOK_PATH
COHUB_HOOK_TASK_RUN_ID
COHUB_HOOK_EVENT_ID
COHUB_HOOK_EVENT_TYPE
COHUB_HOOK_SPACE_ID
COHUB_HOOK_OCCURRED_AT
COHUB_HOOK_EXECUTION_USER_ID
```

Present only when available:

```text
COHUB_HOOK_ACTOR_USER_ID
COHUB_HOOK_SESSION_ID      # mainly session.turn.finalized
COHUB_HOOK_TURN_ID         # session.turn.finalized
COHUB_HOOK_CHECKPOINT_ID   # checkpoint.created
```

`space.fs.changed` extras (no single business id):

```text
COHUB_HOOK_FS_CHANGE_COUNT
COHUB_HOOK_FS_PATHS          # newline-separated, hard-capped
COHUB_HOOK_FS_KINDS          # comma-separated, when present
```

How it is delivered:

- `run`: process env on the `run_command` job (user `env` + system hook env; no temp event file)
- `prompt`: user `env` on the turn; system hook keys on `meta.context.env` for tool execution, plus a short prompt appendix mirrored from system fields

Merge order for process/tool env:

```text
space user env < hook file env < COHUB_HOOK_* / other system keys
```

Also injected by the agent execution context (same as bash tool calls):

```text
COHUB_SPACE_ID
COHUB_USER_UUID
COHUB_EXECUTION_TOKEN
COHUB_SESSION_ID             # when a session is bound
```

Full original event payload remains on the `space_hook` task run:

```text
task_runs.payload.data.event
```

`COHUB_HOOK_TASK_RUN_ID` is the DB `task_runs.id` (UUID) so `GET /api/tasks/:id` can resolve it.

## MVP limits

- No dedicated hook permissions / approval model
- No hook-level concurrency control
- Local sandbox workspaces are not mounted on Worker; hook discovery currently assumes cloud PVC access
- History is stored in existing `task_runs` rows of type `space_hook`
- Hook failures are recorded in the task result but do not trigger BullMQ retry (avoids duplicate execution storms)
- `.cohub/**` paths are always ignored in fs hook matching to prevent self-trigger loops
