# syntax=docker/dockerfile:1.4
# Cohub API Dockerfile
# Hono + Node.js runtime - Multi-stage build with pnpm deploy

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
COPY apps/api/package.json ./apps/api/package.json

# Install full deps (build needs dev deps like typescript)
# --ignore-scripts to skip "prepare" (husky) — no git in Docker
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store && \
  pnpm install --frozen-lockfile --ignore-scripts --filter @cohub/api...

# Copy source and build runtime JS output
COPY packages/protocol ./packages/protocol
COPY apps/api/src ./apps/api/src
COPY apps/api/tsconfig.json apps/api/tsconfig.build.json ./apps/api/
COPY apps/api/drizzle ./apps/api/drizzle

RUN pnpm --filter @cohub/protocol build
RUN pnpm --filter @cohub/api build
RUN pnpm --filter @cohub/api --prod deploy /prod/api

# ============================================
# Stage 2: runtime
# ============================================
FROM node:24-slim AS runtime

ENV NODE_ENV=production
ENV PORT=8787

WORKDIR /app

COPY --from=builder /prod/api ./

# Run as non-root
USER node

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:8787/healthz', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "dist/index.js"]
