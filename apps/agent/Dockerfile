# syntax=docker/dockerfile:1.4
# Cohub Agent Dockerfile

FROM node:24-slim AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

FROM base AS builder
COPY .npmrc pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/protocol/package.json ./packages/protocol/package.json
COPY packages/protocol/tsconfig.json ./packages/protocol/tsconfig.json
COPY packages/protocol/tsconfig.build.json ./packages/protocol/tsconfig.build.json
COPY packages/agent-sandbox-protocol/package.json ./packages/agent-sandbox-protocol/package.json
COPY packages/agent-sandbox-protocol/tsconfig.json ./packages/agent-sandbox-protocol/tsconfig.json
COPY packages/agent-sandbox-protocol/tsconfig.build.json ./packages/agent-sandbox-protocol/tsconfig.build.json
COPY apps/agent/package.json ./apps/agent/package.json

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store && \
  pnpm install --frozen-lockfile --ignore-scripts --filter @cohub/agent...

COPY packages/protocol ./packages/protocol
COPY packages/agent-sandbox-protocol ./packages/agent-sandbox-protocol
COPY apps/agent/src ./apps/agent/src
COPY apps/agent/tsconfig.json ./apps/agent/tsconfig.json

RUN pnpm --filter @neta-art/cohub-protocol build
RUN pnpm --filter @cohub/agent-sandbox-protocol build
RUN pnpm --filter @cohub/agent build
RUN pnpm --filter @cohub/agent --prod deploy /prod/agent

FROM node:24-slim AS runtime
ENV NODE_ENV=production
ENV WORKSPACE_ROOT=/space-storage
ENV SESSIONS_DIR=/sessions
WORKDIR /app

COPY --from=builder /prod/agent ./
RUN mkdir -p "$WORKSPACE_ROOT" "$SESSIONS_DIR" && chown -R node:node "$WORKSPACE_ROOT" "$SESSIONS_DIR" /app

USER node
CMD ["node", "dist/index.js"]
