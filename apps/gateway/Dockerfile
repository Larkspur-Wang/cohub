# syntax=docker/dockerfile:1.4
# Cohub Gateway Dockerfile
# Multi-stage build with pnpm deploy

# ============================================
# Base: common build tooling
# ============================================
FROM node:24-slim AS base

WORKDIR /app

# Use Corepack to manage pnpm
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

# Optional: npm registry mirror (useful in CN networks)
RUN echo 'registry=https://registry.npmmirror.com/' > /root/.npmrc

# ============================================
# Stage 1: build workspace and deploy portable app
# ============================================
FROM base AS builder

COPY .npmrc pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/protocol/package.json ./packages/protocol/package.json
COPY packages/protocol/tsconfig.json ./packages/protocol/tsconfig.json
COPY packages/protocol/tsconfig.build.json ./packages/protocol/tsconfig.build.json
COPY apps/gateway/package.json ./apps/gateway/package.json

# Install full deps (build needs dev deps like typescript)
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store && \
  pnpm install --frozen-lockfile --ignore-scripts --filter @cohub/gateway...

COPY packages/protocol ./packages/protocol
COPY apps/gateway/src ./apps/gateway/src
COPY apps/gateway/tsconfig.json ./apps/gateway/tsconfig.json

RUN pnpm --filter @cohub/protocol build
RUN pnpm --filter @cohub/gateway build
RUN pnpm --filter @cohub/gateway --prod deploy /prod/gateway

# ============================================
# Stage 2: runtime
# ============================================
FROM node:24-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY --from=builder /prod/gateway ./

# Run as non-root
USER node

EXPOSE 8788

CMD ["node", "dist/index.js"]
