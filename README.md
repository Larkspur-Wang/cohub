# Cohub

*Create in spaces. Save checkpoints. Co-create with agents.*

Cohub is a cloud platform for **space-based agent creation, execution, and collaboration**.

It combines:
- **JupyterLab / Colab-like** in-browser creation and debugging
- **Heroku / Fly.io-like** local-to-cloud deployment
- **GitHub / Hugging Face-like** sharing, reuse, and community collaboration

## Core Concepts

### Space
A **Space** is the core unit in Cohub.

A space is a live, isolated working environment where users and agents create together. It contains ongoing conversations, file changes, experiments, and unpublished drafts.

A space is:
- the main place where creation happens
- the unit you open in the browser
- the unit you run agents inside
- the unit you can later save, fork, and evolve

### Checkpoint
A **Checkpoint** is an immutable snapshot saved from a space.

It captures a meaningful milestone in time and becomes a stable base for sharing, rollback, branching, and reuse.

A checkpoint is:
- a frozen snapshot of a space state
- the basis for sharing and discovery
- the source for future forks
- the safe anchor point for collaboration

### Proposal
A **Proposal** is the collaboration flow for contributing one checkpoint back into another space.

It is Cohub’s co-creation primitive for review, discussion, and merge-like integration.

### Agent
An **Agent** is the executable logic that works inside a space.

If the space is the creative environment, the agent is the active collaborator operating within it.

### Session
A **Session** is an internal LLM conversation context inside a space.

Each session maintains its own interaction history and can evolve independently as users explore ideas with agents.

### Channel
A **Channel** is an external communication endpoint connected to a space.

Examples include Web, Discord, Telegram, and Feishu. Users interact through channels, and agents can send results back through them.

### Sandbox
A **Sandbox** is the internal execution infrastructure behind a space.

Sandbox state still exists in the system, but it is treated as infrastructure rather than a primary user-facing concept.

## Positioning

Cohub is built around the idea that **spaces are the primary creative surface**, while **checkpoints are the durable assets** created from them.

The platform is for:
- **creating** with agents in live spaces
- **saving** milestones as checkpoints
- **forking** from checkpoints into new spaces
- **proposing** changes back for collaborative integration
- **deploying** agent-powered workloads from space context

> Cohub is a cloud platform for creating in spaces, saving checkpoints, and collaborating with agents.

## Co-Creation Workflow

### 1. Create in a Space
Start a space, chat with an agent, edit files, and iterate in the browser.

### 2. Save a Checkpoint
When a space reaches a meaningful milestone, save it as a checkpoint.

### 3. Fork and Explore
Fork from an existing checkpoint into a new isolated space for further exploration.

### 4. Propose Back
Turn your result into a proposal and contribute it back into another space.

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
│   ├── api/          # Hono API — orchestration, provisioning, session persistence
│   ├── agent/        # Space sandbox supervisor — wraps Pi coding agent
│   ├── gateway/      # External channel provider gateway (independent deploy)
│   ├── web/          # SvelteKit web console
│   └── worker/       # Task scheduler — cron jobs & async task processing
├── deploy/           # Deployment configs (K8s manifests per env)
├── docs/             # Architecture, migration, and product model docs
├── packages/
│   └── protocol/     # Shared types & protocols across apps
├── scripts/          # Utility scripts
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

Recommended starting points:
- `docs/CO-CREATION-MODEL.md`
- `docs/MIGRATION-PROGRESS.md`
- `docs/SCHEMA-MIGRATION-PLAN.md`
