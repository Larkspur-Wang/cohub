---
name: cohub
description: Work with Cohub spaces, chats, files, saves, labels, tasks, and scheduled prompts.
---

# Cohub

Use the Cohub CLI for platform operations, and use file tools for normal file work.

Prefer simple, explicit commands. Use `--json` when reading output for decisions, extracting IDs, or chaining commands.

Most commands can target the current Cohub sandbox context. If a command asks for a target Space, add `-s "$COHUB_SPACE_ID"` or an explicit Space ID.

For command details, use `-h`:

```bash
cohub -h
cohub spaces -h
cohub spaces prompt -h
```

## Installation

If `cohub` is unavailable, install it and check availability:

```bash
npm install -g @neta-art/cohub-cli
cohub --help
```

## Terminology

Cohub has user-facing product terms and CLI/API terms. Treat them as equivalent:

| Product UI | CLI / API |
|---|---|
| Chat | Session |
| Save | Checkpoint |
| Tasks | Task runs |
| Scheduled prompt | `spaces prompt` schedule |
| Recurring scheduled prompt | Cron job |

When talking to users, prefer product UI terms: Chat, Save, Tasks, and Scheduled prompt.

Use `spaces prompt` for both immediate and scheduled sends. Use `tasks` and `cron-jobs` mainly for inspection and management.

## Context

Cohub environments may provide context variables:

```bash
COHUB_SPACE_ID
COHUB_SESSION_ID
```

Use them as defaults when the user has not specified a target.

Inspect context if needed:

```bash
env | grep '^COHUB_'
```

Do not guess IDs. If no target is available and the command cannot infer the current context, ask the user.

## Spaces

List Spaces:

```bash
cohub spaces ls
```

Get a Space:

```bash
cohub spaces get <spaceId>
```

Create a Space:

```bash
cohub spaces create --name "<name>" --description "<description>"
```

Rename a Space:

```bash
cohub spaces rename <spaceId> "<new name>"
```

For more Space commands:

```bash
cohub spaces -h
```

Upload a Space avatar:

```bash
cohub spaces avatar <path>
```

## Chats and Prompts

Use `spaces prompt` for all sends: immediate, delayed, one-time scheduled, recurring scheduled, new Chat, or existing Chat.

Send a prompt now:

```bash
cohub spaces prompt "message"
```

If a target Space is required:

```bash
cohub -s "$COHUB_SPACE_ID" spaces prompt "message"
cohub -s <spaceId> spaces prompt "message"
```

Send long content from stdin:

```bash
cat prompt.md | cohub spaces prompt
```

Send to an existing Chat:

```bash
cohub spaces prompt \
  --session <sessionId> \
  "message"
```

Create a new Chat and send:

```bash
cohub spaces prompt \
  --title "<chat title>" \
  "message"
```

Choose a model or provider when needed:

```bash
cohub spaces prompt \
  --model <model> \
  --provider <provider> \
  "message"
```

Other useful options:

```bash
cohub spaces prompt --read-only "message"          # Use read-only tools
cohub spaces prompt --steer "message"              # Interrupt the current turn and run now
cohub spaces prompt --label Bug --label Area/Frontend "message"  # Attach labels
```

Schedule a delayed prompt:

```bash
cohub spaces prompt \
  --delay-ms 600000 \
  "message"
```

Schedule a one-time prompt:

```bash
cohub spaces prompt \
  --at "2026-05-12T09:00:00+08:00" \
  "message"
```

Schedule a recurring prompt:

```bash
cohub spaces prompt \
  --cron "0 9 * * 1-5" \
  --timezone "Asia/Shanghai" \
  --title "Daily reminder" \
  "message"
```

Scheduling rules:

- Use only one of `--delay-ms`, `--at`, or `--cron`.
- `--cron` requires `--timezone`.
- Confirm before creating scheduled or recurring prompts with side effects.
- Be careful when prompting the current Chat if it could trigger confusing recursive behavior.

For all prompt options:

```bash
cohub spaces prompt -h
```

## Chats / Sessions

List Chats:

```bash
cohub spaces sessions ls
```

Create a Chat:

```bash
cohub spaces sessions create "<title>"
```

Get a Chat:

```bash
cohub spaces sessions get <sessionId>
```

Rename a Chat:

```bash
cohub spaces sessions rename <sessionId> "<new title>"
```

Use `spaces prompt --session <sessionId>` to send to a Chat.

For more Chat commands:

```bash
cohub spaces sessions -h
```

## Search

Search Spaces, Chats, and prior turns:

```bash
cohub search "query"
cohub search "query" --limit 20
cohub search "query" --types turn,session,space
cohub search "query" --space-id <spaceId>
```

Use Cohub search for product-level discovery. Use file tools such as `find` and `grep` for workspace file search.

## Labels

Manage labels and attach them to resources such as Chats:

```bash
cohub spaces labels ls
cohub spaces labels create <labelRef>
cohub spaces labels update <labelRef>
cohub spaces labels rm <labelRef>
cohub spaces labels reorder <labelRefs...>
```

A `labelRef` may be nested, e.g. `Bug` or `Area/Frontend`.

Resource types: `session`, `checkpoint`, `file`.

Attach, detach, or replace labels on a resource:

```bash
cohub spaces labels attach <labelRef> <resourceType> <resourceRef>
cohub spaces labels detach <labelRef> <resourceType> <resourceRef>
cohub spaces labels set <resourceType> <resourceRef> [labelRefs...]
cohub spaces labels items <labelRef>
```

When sending, attach labels directly with `spaces prompt --label <ref>`.

## Models

List LLM models:

```bash
cohub models ls
```

For multimodal image, video, and music generation, use the `cohub-generate` skill (`cohub generate`, `cohub models ls --model-type multimodal`, `cohub models show`).

## Files

Prefer file tools for normal file inspection and edits. They are also suitable for cross-space read/list/search when `space_id` is supported.

Use CLI file commands only when tools are unavailable or when managing platform-side files such as upload, move, rename, or delete.

List files:

```bash
cohub spaces files ls [path]
```

Read a file:

```bash
cohub spaces files cat <path>
```

Write a file:

```bash
cohub spaces files write <path> -c "<content>"
```

Upload files:

```bash
cohub spaces files upload <files...> --dir <dir>
```

Move or rename:

```bash
cohub spaces files mv <from> <to>
```

Delete:

```bash
cohub spaces files rm <path>
cohub spaces files rm -r <path>
```

Confirm before deleting files or directories.

For more file commands:

```bash
cohub spaces files -h
```

## Saves

List Saves:

```bash
cohub spaces checkpoints ls
```

Get a Save:

```bash
cohub spaces checkpoints get <checkpointId>
```

Create a Save:

```bash
cohub spaces checkpoints create "<description>"
```

Create a Save after meaningful milestones or when the user asks to save progress.

## Tasks

The product UI shows Tasks. In the CLI/API, these are task runs.

List task runs:

```bash
cohub tasks ls --space "$COHUB_SPACE_ID"
cohub tasks ls --space <spaceId>
```

Get task run details:

```bash
cohub tasks get <taskRunId>
```

Do not create scheduled sends through task commands. Use `spaces prompt` scheduling flags instead.

For details:

```bash
cohub tasks -h
```

## Recurring Scheduled Prompt Management

Create recurring scheduled prompts with `spaces prompt --cron ... --timezone ...`.

Use `cron-jobs` only to inspect or manage recurring scheduled prompts after creation.

List recurring scheduled prompts:

```bash
cohub cron-jobs ls "$COHUB_SPACE_ID"
cohub cron-jobs ls <spaceId>
```

List runs:

```bash
cohub cron-jobs runs <cronJobId>
```

Enable or disable:

```bash
cohub cron-jobs toggle <cronJobId> on
cohub cron-jobs toggle <cronJobId> off
```

Delete:

```bash
cohub cron-jobs delete <cronJobId>
```

Confirm before enabling, disabling, or deleting recurring scheduled prompts.

For details:

```bash
cohub cron-jobs -h
```

## Common Workflows

### Inspect current Cohub context

```bash
env | grep '^COHUB_'
cohub spaces get "$COHUB_SPACE_ID"
cohub spaces sessions ls
```

### Send work to a new Chat

```bash
cohub spaces prompt \
  --title "<chat title>" \
  "<message>"
```

## Profile

Upload your avatar:

```bash
cohub profile avatar <path>
```

## Advanced

Use `-h` for less common management commands:

```bash
cohub channels -h
cohub models -h
cohub prompts -h
cohub spaces members -h
cohub spaces access -h
cohub spaces sessions access -h
cohub spaces usage -h
```

## Safety

Confirm before:

- deleting files or directories
- creating scheduled or recurring prompts with side effects
- enabling, disabling, or deleting recurring scheduled prompts
- changing access policies, member roles, or membership
- sending prompts that may trigger recursive agent behavior

