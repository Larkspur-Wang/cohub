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

run: |
  npm test
```

Prompt action:

```yaml
schema: cohub.space-hook.v1

on:
  event: checkpoint.created

prompt:
  text: summarize the new checkpoint and suggest next steps
  intent: followup
```

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

## Environment for run hooks

Set by `buildHookRunCommand`:

```text
COHUB_HOOK_PATH
COHUB_HOOK_TASK_RUN_ID
COHUB_HOOK_EVENT_ID
COHUB_HOOK_EVENT_TYPE
COHUB_HOOK_EVENT_FILE
```

Injected by the agent execution context (same as bash tool calls):

```text
COHUB_SPACE_ID
COHUB_USER_UUID
COHUB_EXECUTION_TOKEN
```

## MVP limits

- No dedicated hook permissions / approval model
- No hook-level concurrency control
- Local sandbox workspaces are not mounted on Worker; hook discovery currently assumes cloud PVC access
- History is stored in existing `task_runs` rows of type `space_hook`
odel
- No hook-level concurrency control
- Local sandbox workspaces are not mounted on Worker; hook discovery currently assumes cloud PVC access
- History is stored in existing `task_runs` rows of type `space_hook`
- Hook failures are recorded in the task result but do not trigger BullMQ retry (avoids duplicate execution storms)
- `.cohub/**` paths are always ignored in fs hook matching to prevent self-trigger loops
