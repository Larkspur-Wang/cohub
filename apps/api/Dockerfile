# Cohub API Dockerfile
# Hono + Node.js runtime - Multi-stage build

# ============================================
# Base: common build tooling
# ============================================
FROM node:22-slim AS base

WORKDIR /app

# Use Corepack to manage pnpm
RUN corepack enable && corepack prepare pnpm@9.12.1 --activate

# Optional: npm registry mirror (useful in CN networks)
RUN echo 'registry=https://registry.npmmirror.com/' > /root/.npmrc

# ============================================
# Stage 1: deps (production dependencies only)
# ============================================
FROM base AS deps

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/protocol/package.json ./packages/protocol/package.json
COPY apps/api/package.json ./apps/api/package.json

# Install production deps for @cohub/api
# Use hoisted linker to make runtime copy simpler (no pnpm needed in runtime image)
RUN pnpm config set node-linker hoisted \
  && pnpm install --frozen-lockfile --prod --filter @cohub/api...

# ============================================
# Stage 2: build
# ============================================
FROM base AS builder

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/protocol/package.json ./packages/protocol/package.json
COPY packages/protocol/tsconfig.json ./packages/protocol/tsconfig.json
COPY packages/protocol/tsconfig.build.json ./packages/protocol/tsconfig.build.json
COPY apps/api/package.json ./apps/api/package.json

# Install full deps (build needs dev deps like typescript)
RUN pnpm config set node-linker hoisted \
  && pnpm install --frozen-lockfile --filter @cohub/api...

# Copy protocol source and build runtime JS output
COPY packages/protocol ./packages/protocol
RUN pnpm --filter @cohub/protocol build

# Copy api source and build
COPY apps/api/src ./apps/api/src
COPY apps/api/tsconfig.json apps/api/tsconfig.build.json ./apps/api/
COPY apps/api/drizzle ./apps/api/drizzle

RUN pnpm --filter @cohub/api build

# ============================================
# Stage 3: production
# ============================================
FROM node:22-slim AS production

ENV NODE_ENV=production
ENV PORT=8787

WORKDIR /app

# Copy runtime dependencies and built output
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/packages/protocol/dist ./packages/protocol/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/drizzle ./apps/api/drizzle
COPY apps/api/package.json ./apps/api/package.json
COPY packages/protocol/package.runtime.json ./packages/protocol/package.json

# Run as non-root
USER node

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:8787/healthz', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

WORKDIR /app/apps/api

CMD ["node", "dist/index.js"]
