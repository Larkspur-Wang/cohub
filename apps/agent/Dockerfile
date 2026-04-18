# syntax=docker/dockerfile:1.4
# Cohub Agent Dockerfile
# Multi-stage build with pnpm deploy

# ============================================
# Base: build tooling
# ============================================
FROM node:24-slim AS base

WORKDIR /app

# Use Corepack to manage pnpm
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

# ============================================
# Stage 1: build workspace and deploy portable app
# ============================================
FROM base AS builder

COPY .npmrc pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/protocol/package.json ./packages/protocol/package.json
COPY packages/protocol/tsconfig.json ./packages/protocol/tsconfig.json
COPY packages/protocol/tsconfig.build.json ./packages/protocol/tsconfig.build.json
COPY apps/agent/package.json ./apps/agent/package.json

# Install full deps (build needs dev deps like typescript)
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store && \
  pnpm install --frozen-lockfile --ignore-scripts --filter @cohub/agent...

COPY packages/protocol ./packages/protocol
COPY apps/agent/src ./apps/agent/src
COPY apps/agent/tsconfig.json ./apps/agent/tsconfig.json

RUN pnpm --filter @cohub/protocol build
RUN pnpm --filter @cohub/agent build
RUN pnpm --filter @cohub/agent --prod deploy /prod/agent

# ============================================
# Stage 2: runtime
# ============================================
FROM node:24-slim AS runtime

ENV NODE_ENV=production
ENV SPACE_DIR=/workspace

WORKDIR /app

COPY --from=builder /prod/agent ./

# Create workspace directory for session storage
RUN mkdir -p "$SPACE_DIR" && chown node:node "$SPACE_DIR"

# Run as non-root
USER node

CMD ["node", "dist/index.js"]
