# Cohub Gateway Dockerfile
# Multi-stage build

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
# Stage 1: deps (production dependencies only)
# ============================================
FROM base AS deps

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/protocol/package.json ./packages/protocol/package.json
COPY apps/gateway/package.json ./apps/gateway/package.json

# Install production deps
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter @cohub/gateway...

# ============================================
# Stage 2: build
# ============================================
FROM base AS builder

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/protocol/package.json ./packages/protocol/package.json
COPY apps/gateway/package.json ./apps/gateway/package.json

# Install full deps (build needs dev deps like typescript)
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @cohub/gateway...

COPY packages/protocol ./packages/protocol
COPY apps/gateway/src ./apps/gateway/src
COPY apps/gateway/tsconfig.json ./apps/gateway/tsconfig.json

RUN pnpm --filter @cohub/gateway build

# ============================================
# Stage 3: production
# ============================================
FROM node:24-slim AS production

ENV NODE_ENV=production

WORKDIR /app

# Copy runtime dependencies and built output
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/apps/gateway/dist ./apps/gateway/dist
COPY apps/gateway/package.json ./apps/gateway/package.json

# Run as non-root
USER node

EXPOSE 8788

WORKDIR /app/apps/gateway

CMD ["node", "dist/index.js"]