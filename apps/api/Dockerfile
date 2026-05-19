# syntax=docker/dockerfile:1.4
# Cohub API Dockerfile

FROM node:24-slim AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
RUN echo 'registry=https://registry.npmmirror.com/' > /root/.npmrc

FROM base AS builder
COPY .npmrc pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/identity/package.json ./packages/identity/package.json
COPY packages/identity/tsconfig.json ./packages/identity/tsconfig.json
COPY packages/identity/tsconfig.build.json ./packages/identity/tsconfig.build.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/core/tsconfig.json ./packages/core/tsconfig.json
COPY packages/core/tsconfig.build.json ./packages/core/tsconfig.build.json
COPY packages/sandbox-controller/package.json ./packages/sandbox-controller/package.json
COPY packages/sandbox-controller/tsconfig.json ./packages/sandbox-controller/tsconfig.json
COPY packages/sandbox-controller/tsconfig.build.json ./packages/sandbox-controller/tsconfig.build.json
COPY packages/protocol/package.json ./packages/protocol/package.json
COPY packages/protocol/tsconfig.json ./packages/protocol/tsconfig.json
COPY packages/protocol/tsconfig.build.json ./packages/protocol/tsconfig.build.json
COPY packages/infra/package.json ./packages/infra/package.json
COPY packages/infra/tsconfig.json ./packages/infra/tsconfig.json
COPY packages/infra/tsconfig.build.json ./packages/infra/tsconfig.build.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/db/tsconfig.json ./packages/db/tsconfig.json
COPY packages/db/tsconfig.build.json ./packages/db/tsconfig.build.json
COPY apps/api/package.json ./apps/api/package.json

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store && \
  pnpm install --frozen-lockfile --ignore-scripts --filter @cohub/api...

COPY packages/identity ./packages/identity
COPY packages/core ./packages/core
COPY packages/sandbox-controller ./packages/sandbox-controller
COPY packages/protocol ./packages/protocol
COPY packages/infra ./packages/infra
COPY packages/db ./packages/db
COPY apps/api/src ./apps/api/src
COPY apps/api/tsconfig.json apps/api/tsconfig.build.json ./apps/api/
COPY apps/api/drizzle ./apps/api/drizzle

RUN pnpm --filter @cohub/api... build
RUN pnpm --filter @cohub/api --prod deploy /prod/api

FROM node:24-slim AS runtime
ENV NODE_ENV=production
ENV PORT=8787
WORKDIR /app

COPY --from=builder /prod/api ./
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:8787/healthz', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"
CMD ["node", "dist/index.js"]
