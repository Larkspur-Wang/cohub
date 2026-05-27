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
RUN printf 'registry=https://registry.npmmirror.com/\n@neta-art:registry=https://registry.npmjs.org/\n' > /root/.npmrc

# ============================================
# Stage 1: build workspace and deploy portable app
# ============================================
FROM base AS builder

COPY .npmrc pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/identity/package.json ./packages/identity/package.json
COPY packages/identity/tsconfig.json ./packages/identity/tsconfig.json
COPY packages/identity/tsconfig.build.json ./packages/identity/tsconfig.build.json
COPY packages/protocol/package.json ./packages/protocol/package.json
COPY packages/protocol/tsconfig.json ./packages/protocol/tsconfig.json
COPY packages/protocol/tsconfig.build.json ./packages/protocol/tsconfig.build.json
COPY packages/infra/package.json ./packages/infra/package.json
COPY packages/infra/tsconfig.json ./packages/infra/tsconfig.json
COPY packages/infra/tsconfig.build.json ./packages/infra/tsconfig.build.json
COPY apps/gateway/package.json ./apps/gateway/package.json

# Install full deps (build needs dev deps like typescript)
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  --mount=type=secret,id=gitea_npm_token \
  GITEA_NPM_TOKEN="$(cat /run/secrets/gitea_npm_token 2>/dev/null || true)" && \
  export GITEA_NPM_TOKEN && \
  if [ -z "$GITEA_NPM_TOKEN" ]; then \
    echo "Missing required build secret: gitea_npm_token"; \
    exit 1; \
  fi && \
  printf '\n//git.talesofai.com/api/packages/talesofai/npm/:_authToken=%s\n' "$GITEA_NPM_TOKEN" >> /root/.npmrc && \
  pnpm config set store-dir /pnpm/store && \
  pnpm install --frozen-lockfile --ignore-scripts --filter @cohub/gateway... && \
  sed -i '/git.talesofai.com\/api\/packages\/talesofai\/npm\/:_authToken=/d' /root/.npmrc

COPY packages/identity ./packages/identity
COPY packages/protocol ./packages/protocol
COPY packages/infra ./packages/infra
COPY apps/gateway/src ./apps/gateway/src
COPY apps/gateway/tsconfig.json apps/gateway/tsconfig.build.json ./apps/gateway/

RUN pnpm --filter @cohub/gateway... build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  --mount=type=secret,id=gitea_npm_token \
  GITEA_NPM_TOKEN="$(cat /run/secrets/gitea_npm_token 2>/dev/null || true)" && \
  export GITEA_NPM_TOKEN && \
  if [ -z "$GITEA_NPM_TOKEN" ]; then \
    echo "Missing required build secret: gitea_npm_token"; \
    exit 1; \
  fi && \
  printf '\n//git.talesofai.com/api/packages/talesofai/npm/:_authToken=%s\n' "$GITEA_NPM_TOKEN" >> /root/.npmrc && \
  pnpm --filter @cohub/gateway --prod deploy /prod/gateway && \
  sed -i '/git.talesofai.com\/api\/packages\/talesofai\/npm\/:_authToken=/d' /root/.npmrc

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
