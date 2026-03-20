# Netaverses Agent Dockerfile
# Multi-stage build: builder + runtime

# ============================================
# Stage 1: builder
# ============================================
FROM node:24-bookworm-slim AS builder

WORKDIR /app

# 安装 pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# 拷贝依赖描述
COPY apps/agent/package.json ./

# 安装所有依赖（包括 devDependencies）
# 使用 hoisted node-linker 确保依赖正确链接
RUN pnpm config set node-linker hoisted && pnpm install

# 拷贝源码并构建
COPY apps/agent/ ./
RUN pnpm run build

# ============================================
# Stage 2: runtime
# ============================================
FROM node:24-bookworm-slim AS runtime

# 设置环境变量
ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# 1. 安装基础系统工具、Python 和多媒体/字体依赖
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

# 2. 安装 pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# 3. 全局安装 pi coding agent
RUN npm install -g @mariozechner/pi-coding-agent

# 4. 安装 Playwright 浏览器及其系统依赖
RUN mkdir -p /ms-playwright && \
    npx -y playwright@1.58.2 install chromium --with-deps

WORKDIR /app

# 4. 拷贝依赖描述并安装生产依赖
COPY apps/agent/package.json ./
RUN pnpm config set node-linker hoisted && pnpm install --prod

# 5. 从构建阶段拷贝编译产物
COPY --from=builder /app/dist ./dist

# 6. 设置沙盒运行时的工作目录
ENV WORKSPACE_DIR=/workspace
RUN mkdir -p $WORKSPACE_DIR

# 启动 Supervisor
CMD ["node", "dist/index.js"]