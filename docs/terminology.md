# Terminology

This document defines the core product terms used across Cohub.

## Workspace
A **Workspace** is the primary unit of runtime, hosting, deployment, and sharing.

It is the package developers work on locally, run in the cloud, deploy to managed infrastructure, and share with others.

A workspace is closer to a runnable project unit than a static repository.

### What it is
- a versionable project unit
- a hostable cloud asset
- a deployable runtime input
- a shareable and reusable package

### What it is not
- not a fictional world or narrative setting
- not only a folder or storage container
- not only a UI workspace in the editor sense

## Agent
An **Agent** is the executable logic that operates within a workspace.

### What it is
- the active behavior that performs tasks
- the logic that interacts with users or systems
- something that can be started in different workspaces

### What it is not
- not the full project container
- not the runtime instance itself

## Runtime
A **Runtime** is the outer execution and lifecycle instance started from a workspace.

A runtime may be running, sleeping, resumable, or stopped. It is the primary object users enter when they launch an agent from a workspace.

### What it is
- an outer execution and lifecycle unit
- a debugging, interaction, or long-lived work instance
- the owner of one or more internal sessions

### What it is not
- not the static workspace
- not the reusable agent definition
- not only the current process state

## Session
A **Session** is an internal LLM / conversation session within a runtime.

Each session maintains conversation context and may form a tree with branches and forks.

### What it is
- an internal conversation / context unit
- the owner of a message tree
- a branchable and forkable session history

### What it is not
- not the outer runtime instance
- not the deployable project unit

## Channel
A **Channel** is an external communication endpoint connected to a runtime.

### What it is
- a way to send input to a runtime
- a way for a runtime to send output back
- an integration surface such as Web, Discord, or Telegram

### What it is not
- not the runtime itself
- not the deployable project unit

## Why these terms
- **Workspace** expresses the primary project and hosting asset
- **Agent** is the executable AI behavior
- **Runtime** fits the outer lifecycle object in Cohub.run
- **Session** aligns with internal LLM / ACP-style conversation sessions
- **Channel** reflects communication and integration boundaries
