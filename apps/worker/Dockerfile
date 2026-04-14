# Cohub Worker Dockerfile
# BullMQ worker + Node.js runtime - Multi-stage build

# ============================================
# Base: common build tooling
# ============================================
FROM node:24-slim AS base

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

RUN echo 'registry=https://registry.npmmirror.com/' > /root/.npmrc

# ============================================
# Stage 1: deps (production dependencies only)
# ============================================
FROM base AS deps

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/protocol/package.json ./packages/protocol/package.json
COPY apps/worker/package.json ./apps/worker/package.json

RUN pnpm config set node-linker hoisted \
  && pnpm install --frozen-lockfile --prod --ignore-scripts --filter @cohub/worker...

# ============================================
# Stage 2: build
# ============================================
FROM base AS builder

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/protocol/package.json ./packages/protocol/package.json
COPY packages/protocol/tsconfig.json ./packages/protocol/tsconfig.json
COPY packages/protocol/tsconfig.build.json ./packages/protocol/tsconfig.build.json
COPY apps/worker/package.json ./apps/worker/package.json

RUN pnpm config set node-linker hoisted \
  && pnpm install --frozen-lockfile --ignore-scripts --filter @cohub/worker...

# Copy protocol source and build
COPY packages/protocol ./packages/protocol
RUN pnpm --filter @cohub/protocol build

# Copy worker source and build
COPY apps/worker/src ./apps/worker/src
COPY apps/worker/tsconfig.json apps/worker/tsconfig.build.json ./apps/worker/

RUN pnpm --filter @cohub/worker build

# ============================================
# Stage 3: production
# ============================================
FROM node:24-slim AS production

ENV NODE_ENV=production

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist
COPY apps/worker/package.json ./apps/worker/package.json

# Bundle @cohub/protocol
RUN mkdir -p /app/node_modules/@cohub/protocol
COPY --from=builder /app/packages/protocol/dist /app/node_modules/@cohub/protocol/dist
COPY packages/protocol/package.runtime.json /app/node_modules/@cohub/protocol/package.json

USER node

WORKDIR /app/apps/worker

CMD ["node", "dist/index.js"]
