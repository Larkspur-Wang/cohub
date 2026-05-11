---
name: cohub
description: Use Cohub runtime paths and CLI to inspect and manage spaces, chats, saves, files, prompts, task runs, schedules, channels, models, members, and access.
---

# Cohub

Use local Cohub runtime paths when inspecting the current Space, and use the Cohub CLI for Cohub control-plane operations.

The CLI may operate the current Cohub context or any explicitly specified Space, Chat, Save, prompt, task run, channel, or schedule.

## Installation

If the `cohub` command is unavailable, install it with:

```bash
npm install -g @neta-art/cohub-cli
```

Check availability:

```bash
cohub --help
```

## Terminology

Cohub has user-facing product terms and CLI/API terms. Treat them as equivalent:

| Product UI | CLI / API |
|---|---|
| Chat | Session |
| Saves | Checkpoints |
| Scheduled prompt | Cron jobs |
| Task / Task run | Task runs |

When talking to users, prefer product UI terms:

- Chat
- Save
- Task / task run

When using commands, use CLI terms:

- `sessions`
- `checkpoints`
- `spaces prompt` for sending, delaying, or scheduling prompts
- `tasks` for task / task run inspection
- `cron-jobs` for scheduled prompt inspection and management

Examples:

```bash
cohub -s <spaceId> spaces sessions ls --json
cohub -s <spaceId> spaces checkpoints create "Save progress" --json
cohub -s <spaceId> spaces prompt "Summarize current project" --json
cohub cron-jobs ls <spaceId> --json
```

## Current Context

Cohub environments may provide context variables:

```bash
COHUB_SPACE_ID
COHUB_SESSION_ID
```

Use them as defaults when the user has not specified a target.

- `COHUB_SPACE_ID` is the default current Space.
- `COHUB_SESSION_ID` is the default current Chat / Session.

They are defaults, not restrictions. If the user gives another Space or Chat ID, use the explicit target.

Inspect context if needed:

```bash
env | grep '^COHUB_'
```

Do not guess IDs. If no target is available, ask the user.

## Runtime Paths

When running in a Cohub Space, some current Space state may be available through local runtime paths.

For current Space inspection, prefer local runtime state. For Cohub control-plane operations, use the CLI.

For the current Space:

- inspect workspace files through the local filesystem
- inspect Chats / Sessions through `/sessions` when available

Use local runtime paths because they are closest to the live execution context.

Use the CLI when:

- operating on another Space
- creating, renaming, or managing Chats
- sending immediate, delayed, or scheduled prompts
- streaming Chat events
- creating Saves
- checking tasks / task runs or schedules
- managing access, members, channels, models, or prompts
- local runtime paths are unavailable or insufficient

## Output Rules

Use `--json` when reading output for decisions, extracting IDs, checking status, or chaining commands.

Good:

```bash
cohub spaces ls --json
cohub spaces get "$COHUB_SPACE_ID" --json
cohub -s "$COHUB_SPACE_ID" spaces sessions ls --json
cohub -s "$COHUB_SPACE_ID" spaces prompt "Summarize this space" --json
cohub tasks ls --space "$COHUB_SPACE_ID" --json
```

Use human-readable table output only when presenting directly to the user.

## Spaces

List Spaces:

```bash
cohub spaces ls --json
```

Get a Space:

```bash
cohub spaces get <spaceId> --json
```

Use current Space:

```bash
cohub spaces get "$COHUB_SPACE_ID" --json
```

Create a Space:

```bash
cohub spaces create --name "<name>" --description "<description>" --json
```

Rename a Space:

```bash
cohub spaces rename <spaceId> "<new name>"
```

## Chats / Sessions

For the current Space, prefer the local sessions runtime path when available:

```bash
ls /sessions
find /sessions -maxdepth 2 -type f
```

Use local inspection for reading current Chat / Session state when it is present under `/sessions`.

Use the CLI when:

- the target is another Space
- `/sessions` is unavailable
- structured platform metadata is needed
- creating, renaming, or managing a Chat
- sending messages or streaming events

List Chats in a Space through the CLI:

```bash
cohub -s <spaceId> spaces sessions ls --json
```

Use current Space through the CLI when needed:

```bash
cohub -s "$COHUB_SPACE_ID" spaces sessions ls --json
```

Create a Chat:

```bash
cohub -s <spaceId> spaces sessions create "<title>" --json
```

Get a Chat through the CLI:

```bash
cohub -s <spaceId> spaces sessions get <sessionId> --json
```

Use current Chat through the CLI when needed:

```bash
cohub -s "$COHUB_SPACE_ID" spaces sessions get "$COHUB_SESSION_ID" --json
```

Rename a Chat:

```bash
cohub -s <spaceId> spaces sessions rename <sessionId> "<new title>"
```

## Messages

For the current Space, prefer `/sessions` for local inspection of Chat / Session messages when available.

Use the CLI when:

- reading messages from another Space
- local session files are unavailable
- paginated platform data is needed
- sending a message
- streaming Chat events

List messages through the CLI:

```bash
cohub -s <spaceId> spaces sessions messages ls <sessionId> --json
```

Use current Chat through the CLI when needed:

```bash
cohub -s "$COHUB_SPACE_ID" spaces sessions messages ls "$COHUB_SESSION_ID" --json
```

Send a message:

```bash
cohub -s <spaceId> spaces sessions messages send <sessionId> "message"
```

Send from stdin:

```bash
echo "message" | cohub -s <spaceId> spaces sessions messages send <sessionId>
```

Stream Chat events:

```bash
cohub -s <spaceId> spaces sessions tail <sessionId>
```

Be careful when sending messages to the current Chat. If this could cause confusing recursive behavior, ask the user first.

## Saves / Checkpoints

List Saves:

```bash
cohub -s <spaceId> spaces checkpoints ls --json
```

Get a Save:

```bash
cohub -s <spaceId> spaces checkpoints get <checkpointId> --json
```

Create a Save:

```bash
cohub -s <spaceId> spaces checkpoints create "<description>" --json
```

Use current Space:

```bash
cohub -s "$COHUB_SPACE_ID" spaces checkpoints create "<description>" --json
```

Create a Save after meaningful milestones or when the user asks to save progress.

## Files

There are two ways to work with files.

### Local workspace files

If files are available in the current workspace, use normal file tools for edits and inspection:

- read
- edit
- write
- bash
- grep
- find
- ls

This is usually best for code changes.

### Cohub Space file API

Use CLI file commands when operating through the Cohub platform API, inspecting another Space, or checking platform-side file state.

List files:

```bash
cohub -s <spaceId> spaces files ls [path] --json
```

Read a file:

```bash
cohub -s <spaceId> spaces files cat <path>
```

Write a file:

```bash
cohub -s <spaceId> spaces files write <path> -c "<content>"
```

Write from stdin:

```bash
cat local-file.txt | cohub -s <spaceId> spaces files write <path>
```

Create directory:

```bash
cohub -s <spaceId> spaces files mkdir <path>
```

Move or rename:

```bash
cohub -s <spaceId> spaces files mv <from> <to>
```

Delete:

```bash
cohub -s <spaceId> spaces files rm <path>
cohub -s <spaceId> spaces files rm -r <path>
```

Confirm before deleting files or directories.

## Prompt Sending and Scheduling

Send a prompt to a Space. If `--session` is omitted, Cohub creates a new Chat when the prompt runs.

```bash
cohub -s <spaceId> spaces prompt "message" --json
```

Send to an existing Chat:

```bash
cohub -s <spaceId> spaces prompt --session <sessionId> "message" --json
```

Send from stdin:

```bash
echo "message" | cohub -s <spaceId> spaces prompt --json
```

Delay a prompt. This creates a task run and returns `taskRunId`:

```bash
cohub -s <spaceId> spaces prompt "message" --delay-ms 600000 --json
```

Send once at an absolute ISO time. The time must include `Z` or an explicit offset:

```bash
cohub -s <spaceId> spaces prompt "message" --at "2026-05-09T10:00:00+08:00" --json
```

Schedule a repeating prompt. Use a 5-field cron expression and an explicit IANA timezone. This creates a cron job and returns `cronJobId`:

```bash
cohub -s <spaceId> spaces prompt "Daily summary" \
  --title "Daily summary" \
  --cron "0 9 * * *" \
  --timezone "Asia/Shanghai" \
  --json
```

Confirm before sending or scheduling prompts with side effects.

## Tasks / Task Runs

List task runs:

```bash
cohub tasks ls --json
```

Filter by Space:

```bash
cohub tasks ls --space <spaceId> --json
```

Use current Space:

```bash
cohub tasks ls --space "$COHUB_SPACE_ID" --json
```

Get task run details:

```bash
cohub tasks get <taskRunId> --json
```

Task runs are created internally by prompt scheduling and system operations. Do not create arbitrary tasks directly.

## Scheduled / Cron Jobs

List Scheduled jobs:

```bash
cohub cron-jobs ls --json
cohub cron-jobs ls <spaceId> --json
```

Create Scheduled prompts with `spaces prompt --cron`; do not create arbitrary cron jobs directly.

Enable or disable:

```bash
cohub cron-jobs toggle <id> on
cohub cron-jobs toggle <id> off
```

List runs:

```bash
cohub cron-jobs runs <id> --json
```

Delete:

```bash
cohub cron-jobs delete <id>
```

Confirm before enabling, disabling, or deleting Scheduled jobs.

## Channels

List channels:

```bash
cohub channels ls --json
```

Create a channel:

```bash
cohub channels create \
  --provider <provider> \
  --name "<name>" \
  --credentials '<json>' \
  --json
```

Delete a channel:

```bash
cohub channels delete <id>
```

Confirm before deleting channels.

## Models and Prompts

List models:

```bash
cohub models ls --json
```

List prompt templates:

```bash
cohub prompts ls --json
```

Filter prompts by Space:

```bash
cohub prompts ls --space <spaceId> --json
```

Use current Space:

```bash
cohub prompts ls --space "$COHUB_SPACE_ID" --json
```

## Members and Access

List members:

```bash
cohub -s <spaceId> spaces members ls --json
```

Update member role:

```bash
cohub -s <spaceId> spaces members update <userId> <host|builder|guest>
```

Remove member:

```bash
cohub -s <spaceId> spaces members remove <userId>
```

Get Space access:

```bash
cohub -s <spaceId> spaces access get --json
```

Set Space access:

```bash
cohub -s <spaceId> spaces access set \
  --signed-in <host|builder|guest|null> \
  --anonymous <host|builder|guest|null> \
  --json
```

Get Chat access:

```bash
cohub session-access get <sessionId> --json
```

Set Chat anonymous access:

```bash
cohub session-access set <sessionId> --anonymous <host|builder|guest|null> --json
```

Remove Chat access override:

```bash
cohub session-access remove <sessionId>
```

Confirm before changing access policies, member roles, or membership.

## Common Workflows

### Inspect current Cohub context

```bash
env | grep '^COHUB_'
ls /sessions 2>/dev/null || true
find /sessions -maxdepth 2 -type f 2>/dev/null || true
cohub spaces get "$COHUB_SPACE_ID" --json
cohub -s "$COHUB_SPACE_ID" spaces checkpoints ls --json
cohub tasks ls --space "$COHUB_SPACE_ID" --json
```

### Continue from current Chat

First inspect local session state when available:

```bash
ls /sessions
find /sessions -maxdepth 2 -type f
```

Use the CLI when structured platform data is needed:

```bash
cohub -s "$COHUB_SPACE_ID" spaces sessions get "$COHUB_SESSION_ID" --json
cohub -s "$COHUB_SPACE_ID" spaces sessions messages ls "$COHUB_SESSION_ID" --json
```

### Create another Chat and send work to it

```bash
cohub -s "$COHUB_SPACE_ID" spaces sessions create "<title>" --json
cohub -s "$COHUB_SPACE_ID" spaces sessions messages send <sessionId> "<message>"
cohub -s "$COHUB_SPACE_ID" spaces sessions tail <sessionId>
```

### Save progress

```bash
cohub -s "$COHUB_SPACE_ID" spaces checkpoints create "<description>" --json
```

## Safety

Confirm before:

- deleting files or directories
- deleting channels
- deleting Scheduled jobs
- changing access policies
- changing member roles
- removing members
- creating scheduled or recurring tasks with side effects
- sending messages that may trigger recursive agent behavior
