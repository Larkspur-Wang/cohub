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
COPY packages/tracing/package.json ./packages/tracing/package.json
COPY packages/tracing/tsconfig.json ./packages/tracing/tsconfig.json
COPY packages/tracing/tsconfig.build.json ./packages/tracing/tsconfig.build.json
COPY packages/bullmq-ops/package.json ./packages/bullmq-ops/package.json
COPY packages/bullmq-ops/tsconfig.json ./packages/bullmq-ops/tsconfig.json
COPY packages/bullmq-ops/tsconfig.build.json ./packages/bullmq-ops/tsconfig.build.json
COPY packages/config-runtime/package.json ./packages/config-runtime/package.json
COPY packages/config-runtime/tsconfig.json ./packages/config-runtime/tsconfig.json
COPY packages/config-runtime/tsconfig.build.json ./packages/config-runtime/tsconfig.build.json
COPY apps/agent/package.json ./apps/agent/package.json

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store && \
  pnpm install --frozen-lockfile --ignore-scripts --filter @cohub/agent...

COPY packages/protocol ./packages/protocol
COPY packages/agent-sandbox-protocol ./packages/agent-sandbox-protocol
COPY packages/tracing ./packages/tracing
COPY packages/bullmq-ops ./packages/bullmq-ops
COPY packages/config-runtime ./packages/config-runtime
COPY apps/agent/src ./apps/agent/src
COPY apps/agent/tsconfig.json apps/agent/tsconfig.build.json ./apps/agent/

RUN pnpm --filter @cohub/agent... build
RUN pnpm --filter @cohub/agent --prod deploy /prod/agent

FROM node:24-slim AS runtime
ENV NODE_ENV=production
ENV WORKSPACE_ROOT=/space-storage
ENV SESSIONS_DIR=/sessions
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && apt-get clean \
  && curl -fsSL https://github.com/sharkdp/fd/releases/download/v10.4.2/fd-v10.4.2-x86_64-unknown-linux-gnu.tar.gz \
    | tar xz --wildcards -C /usr/local/bin --strip-components=1 '*/fd' \
  && curl -fsSL https://github.com/BurntSushi/ripgrep/releases/download/15.1.0/ripgrep-15.1.0-x86_64-unknown-linux-musl.tar.gz \
    | tar xz --wildcards -C /usr/local/bin --strip-components=1 '*/rg' \
  && chmod +x /usr/local/bin/fd /usr/local/bin/rg

COPY --from=builder /prod/agent ./
RUN mkdir -p "$WORKSPACE_ROOT" "$SESSIONS_DIR" && chown -R node:node "$WORKSPACE_ROOT" "$SESSIONS_DIR" /app

USER node
CMD ["node", "dist/index.js"]
