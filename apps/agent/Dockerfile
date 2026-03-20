# Netaverses Agent Dockerfile
# Multi-stage build: builder + runtime

# ============================================
# Stage 1: builder
# ============================================
FROM oven/bun:1.3.10-slim AS builder

WORKDIR /app

# 拷贝依赖描述并安装构建依赖
COPY apps/agent/package.json ./package.json
COPY apps/agent/bun.lock ./bun.lock
RUN bun install --frozen-lockfile

# 拷贝源码并构建
COPY apps/agent/ ./
RUN bun run build

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

# 安装运行时依赖
COPY apps/agent/package.json ./package.json
COPY apps/agent/bun.lock ./bun.lock
RUN bun install --production --frozen-lockfile

# 拷贝编译产物
COPY --from=builder /app/dist ./dist

# 设置沙盒运行时工作目录
RUN mkdir -p "$WORKSPACE_DIR"

# 启动 Supervisor
CMD ["bun", "dist/index.js"]
