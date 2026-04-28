# syntax=docker/dockerfile:1.4
# Cohub API Dockerfile

FROM node:24-slim AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
RUN echo 'registry=https://registry.npmmirror.com/' > /root/.npmrc

FROM base AS builder
COPY .npmrc pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/protocol/package.json ./packages/protocol/package.json
COPY packages/protocol/tsconfig.json ./packages/protocol/tsconfig.json
COPY packages/protocol/tsconfig.build.json ./packages/protocol/tsconfig.build.json
COPY packages/tracing/package.json ./packages/tracing/package.json
COPY packages/tracing/tsconfig.json ./packages/tracing/tsconfig.json
COPY packages/tracing/tsconfig.build.json ./packages/tracing/tsconfig.build.json
COPY packages/agent-sandbox-protocol/package.json ./packages/agent-sandbox-protocol/package.json
COPY packages/agent-sandbox-protocol/tsconfig.json ./packages/agent-sandbox-protocol/tsconfig.json
COPY packages/agent-sandbox-protocol/tsconfig.build.json ./packages/agent-sandbox-protocol/tsconfig.build.json
COPY apps/api/package.json ./apps/api/package.json

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store && \
  pnpm install --frozen-lockfile --ignore-scripts --filter @cohub/api...

COPY packages/protocol ./packages/protocol
COPY packages/tracing ./packages/tracing
COPY packages/agent-sandbox-protocol ./packages/agent-sandbox-protocol
COPY apps/api/src ./apps/api/src
COPY apps/api/tsconfig.json apps/api/tsconfig.build.json ./apps/api/
COPY apps/api/drizzle ./apps/api/drizzle

RUN pnpm --filter @neta-art/cohub-protocol build
RUN pnpm --filter @cohub/tracing build
RUN pnpm --filter @cohub/agent-sandbox-protocol build
RUN pnpm --filter @cohub/api build
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
