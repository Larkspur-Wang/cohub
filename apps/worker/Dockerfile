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
COPY apps/worker/package.json ./apps/worker/package.json

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store && \
  pnpm install --frozen-lockfile --ignore-scripts --filter @cohub/worker...

# Copy source and build
COPY packages/protocol ./packages/protocol
COPY apps/worker/src ./apps/worker/src
COPY apps/worker/tsconfig.json apps/worker/tsconfig.build.json ./apps/worker/

RUN pnpm --filter @cohub/protocol build
RUN pnpm --filter @cohub/worker build
RUN pnpm --filter @cohub/worker --prod deploy /prod/worker

# ============================================
# Stage 2: runtime
# ============================================
FROM node:24-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY --from=builder /prod/worker ./

USER node

CMD ["node", "dist/index.js"]
