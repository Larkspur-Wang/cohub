# Terminology

This document defines the core product terms used across Netaverses.

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

## Session
A **Session** is a live running instance of an agent started from a specific workspace.

### What it is
- a runtime execution context
- a live debugging or execution instance
- the unit that users actually interact with while it is running

### What it is not
- not the static workspace
- not the reusable agent definition

## Channel
A **Channel** is an external communication endpoint connected to a session.

### What it is
- a way to send input to a running session
- a way for a session to send output back
- an integration surface such as Web, Discord, or Telegram

### What it is not
- not the runtime itself
- not the deployable project unit

## Why these terms
- **Workspace** is more technical and operational than "World"
- **Agent** is the most natural term for executable AI behavior
- **Session** clearly expresses a live runtime instance
- **Channel** better reflects communication and integration than "Portal"
