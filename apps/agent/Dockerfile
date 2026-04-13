# Cohub Agent Dockerfile
# Multi-stage build: builder + runtime

# ============================================
# Stage 1: builder
# ============================================
FROM node:24-slim AS builder

WORKDIR /app

# Use Corepack to manage pnpm
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

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
FROM node:24-slim AS runtime

# 设置环境变量
ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
ENV WORKSPACE_DIR=/workspace

# 安装基础系统工具、Python 和常用命令行依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    # 网络与远程访问
    curl git wget jq ca-certificates openssh-client \
    iputils-ping iproute2 dnsutils \
    # 搜索与文件操作
    ripgrep fd-find file unzip zip \
    # Python 生态
    python3 python3-pip python3-venv python3-dev \
    # 多媒体处理
    ffmpeg imagemagick libimage-exiftool-perl \
    # 终端与系统工具
    vim tree tmux htop xz-utils less \
    # 编译工具链
    build-essential \
    # 调试与诊断
    strace lsof \
    # 字体
    fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# 设置 Python 和 fd 软链接
RUN ln -sf /usr/bin/python3 /usr/bin/python && \
    ln -sf /usr/bin/fdfind /usr/local/bin/fd

# 安装 Bun（保留兼容性）
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# 启用 corepack 管理 pnpm
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

# 全局安装 pi coding agent（使用 npm）
RUN npm install -g @mariozechner/pi-coding-agent

WORKDIR /app

# 从 builder 复制 node_modules 和构建产物
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/agent/dist ./apps/agent/dist
COPY apps/agent/package.json ./apps/agent/package.json

# 设置沙盒运行时工作目录
RUN mkdir -p "$WORKSPACE_DIR"

WORKDIR /app/apps/agent

# 启动
CMD ["node", "dist/index.js"]