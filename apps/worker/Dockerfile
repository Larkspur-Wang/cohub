# syntax=docker/dockerfile:1.4
# Cohub Worker Dockerfile
# BullMQ worker + Node.js runtime - Multi-stage build with pnpm deploy

# ============================================
# Base: common build tooling
# ============================================
FROM node:24-slim AS base

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

RUN echo 'registry=https://registry.npmmirror.com/' > /root/.npmrc

# ============================================
# Stage 1: build workspace and deploy portable app
# ============================================
FROM base AS builder

COPY .npmrc pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/protocol/package.json ./packages/protocol/package.json
COPY packages/protocol/tsconfig.json ./packages/protocol/tsconfig.json
COPY packages/protocol/tsconfig.build.json ./packages/protocol/tsconfig.build.json
COPY packages/infra/package.json ./packages/infra/package.json
COPY packages/infra/tsconfig.json ./packages/infra/tsconfig.json
COPY packages/infra/tsconfig.build.json ./packages/infra/tsconfig.build.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/db/tsconfig.json ./packages/db/tsconfig.json
COPY packages/db/tsconfig.build.json ./packages/db/tsconfig.build.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/core/tsconfig.json ./packages/core/tsconfig.json
COPY packages/core/tsconfig.build.json ./packages/core/tsconfig.build.json
COPY apps/worker/package.json ./apps/worker/package.json

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store && \
  pnpm install --frozen-lockfile --ignore-scripts --filter @cohub/worker...

# Copy source and build
COPY packages/protocol ./packages/protocol
COPY packages/infra ./packages/infra
COPY packages/db ./packages/db
COPY packages/core ./packages/core
COPY apps/worker/src ./apps/worker/src
COPY apps/worker/tsconfig.json apps/worker/tsconfig.build.json ./apps/worker/

RUN pnpm --filter @cohub/worker... build
RUN pnpm --filter @cohub/worker --prod deploy /prod/worker

# ============================================
# Stage 2: runtime
# ============================================
FROM node:24-slim AS runtime

ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && \
  rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /prod/worker ./

USER node

CMD ["node", "dist/index.js"]
