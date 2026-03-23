# Cohub Agent Dockerfile
# Multi-stage build: builder + runtime

# ============================================
# Stage 1: builder
# ============================================
FROM node:22-slim AS builder

WORKDIR /app

# Use Corepack to manage pnpm
RUN corepack enable && corepack prepare pnpm@9.12.1 --activate

# 拷贝 workspace 配置和依赖描述
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/protocol/package.json ./packages/protocol/
COPY apps/agent/package.json ./apps/agent/

# 安装所有依赖
RUN pnpm config set node-linker hoisted \
  && pnpm install --frozen-lockfile --filter @cohub/agent...

# 拷贝源码
COPY packages/protocol ./packages/protocol
COPY apps/agent/src ./apps/agent/src
COPY apps/agent/tsconfig.json ./apps/agent/tsconfig.json

# 构建
RUN pnpm --filter @cohub/agent build

# ============================================
# Stage 2: runtime
# ============================================
FROM oven/bun:1.3.10-slim AS runtime

# 设置环境变量
ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
ENV WORKSPACE_DIR=/workspace

# 安装基础系统工具、Python 和常用命令行依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl git wget jq ca-certificates \
    iputils-ping \
    ripgrep fd-find \
    python3 python3-pip python3-venv \
    ffmpeg imagemagick libimage-exiftool-perl \
    unzip vim tree tmux htop xz-utils \
    fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

# 设置 Python 和 fd 软链接
RUN ln -sf /usr/bin/python3 /usr/bin/python && \
    ln -sf /usr/bin/fdfind /usr/local/bin/fd

# 全局安装 pi coding agent，保留容器内 pi 命令
RUN bun install -g @mariozechner/pi-coding-agent

WORKDIR /app

# 从 builder 复制 node_modules 和构建产物
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/protocol/dist ./packages/protocol/dist
COPY --from=builder /app/apps/agent/dist ./apps/agent/dist
COPY apps/agent/package.json ./apps/agent/package.json
COPY packages/protocol/package.json ./packages/protocol/package.json

# 设置沙盒运行时工作目录
RUN mkdir -p "$WORKSPACE_DIR"

WORKDIR /app/apps/agent

# 启动
CMD ["bun", "dist/index.js"]