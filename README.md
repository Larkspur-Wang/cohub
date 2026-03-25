# Cohub

*Host workspaces. Run agents.*

Cohub is a **workspace hosting platform** for deploying and running agents in the cloud.

It combines:
- **JupyterLab / Colab-like** browser-based runtime and debugging
- **Heroku / Fly.io-like** local-to-cloud deployment
- **GitHub / Hugging Face-like** workspace hosting, sharing, and reuse

## Core Concepts

### Workspace
A **Workspace** is the core unit in Cohub.

It is a versionable, hostable, shareable, and deployable package that contains the project context, configuration, code, and resources needed to run agent workloads.

A workspace is:
- the unit you host in the cloud
- the unit you push from local to remote
- the unit you share with others
- the unit you deploy agents from
- the unit others can reuse or fork

### Agent
An **Agent** is the executable logic that runs within a workspace.

If the workspace is the project unit, the agent is the runtime behavior operating inside it.

### Runtime
A **Runtime** is a runtime instance of an agent started from a specific workspace.

A runtime may be active, sleeping, resumable, or stopped. It is the outer lifecycle unit used for execution, debugging, and long-lived interaction.

A runtime can contain one or more internal sessions.

### Session
A **Session** is an internal LLM / conversation session within a runtime.

Each session maintains its own conversation context and may evolve as a tree with branches and forks.

### Channel
A **Channel** is an external communication endpoint for a runtime.

Examples include Web, Discord, and Telegram. Users interact with agents through channels, and agents can send results back through them.

## Positioning

Cohub is built around the idea that **workspaces are the primary cloud asset**.

The platform is for:
- **hosting** reusable workspaces
- **running** agents from those workspaces
- **deploying** workspace-based agent workloads
- **distributing** reusable workspaces to other developers

> Cohub is a cloud platform for hosting reusable workspaces and deploying agents from them.

## Use Cases

### 1. Browser-based runtime
Start an agent directly from a workspace in the browser for cloud debugging and execution.

### 2. Local-to-cloud deployment
Push a local workspace to the cloud and deploy an agent from it.

### 3. Multi-channel interaction
Run long-lived tasks in the cloud, push results through channels such as Discord or Telegram, and continue execution from user replies.

### 4. Workspace sharing and reuse
Host mature workspaces like code on GitHub or models on Hugging Face, so other developers can discover, reuse, and build on top of them.

## Terminology Notes

- **Workspace**: a runnable, hostable, shareable project unit
- **Agent**: executable behavior running inside a workspace
- **Runtime**: the outer runtime instance / lifecycle unit
- **Session**: an internal LLM or conversation session inside a runtime
- **Channel**: an external communication interface

## Tech Stack

- **Language**: TypeScript
- **Frontend**: SvelteKit
- **Backend**: Hono
- **Database**: PostgreSQL + Drizzle ORM
- **Infrastructure**: Kubernetes (ACK)
- **Package Manager**: pnpm monorepo

## Repository Structure

```text
cohub/
├── apps/
│   ├── api/          # orchestration and runtime services
│   └── web/          # web console
├── deploy/           # deployment configs
├── docs/             # architecture and design docs
├── packages/         # shared packages
└── README.md
```

## Development

```bash
pnpm install
pnpm dev
```

### Quality Checks

```bash
pnpm lint
pnpm typecheck
pnpm build
```

## Docs

- `docs/terminology.md`
- `docs/runtime-session-model.md`
- `docs/use-cases.md`
- `docs/db-schema.md`

## Roadmap

- **Phase 1**: establish the Workspace + Agent + Runtime + internal Session + Web Channel loop
- **Phase 2**: improve cloud runtime, debugging, and task lifecycle management
- **Phase 3**: support local workspace push-to-cloud deployment and more channel integrations
- **Phase 4**: build workspace sharing, reuse, and distribution flows
