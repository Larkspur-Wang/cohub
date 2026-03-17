# 使用轻量的 Node.js 24 镜像作为基础
FROM node:24-bookworm-slim

# 设置环境变量
ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
# 确保 Playwright 知道在哪里找到浏览器
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# 1. 安装基础系统工具、Python 和多媒体/字体依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    wget \
    jq \
    ca-certificates \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    imagemagick \
    libimage-exiftool-perl \
    unzip \
    vim \
    tree \
    tmux \
    htop \
    xz-utils \
    fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

# 设置 Python 软链接
RUN ln -sf /usr/bin/python3 /usr/bin/python

# 2. 全局安装 pnpm 和 tsx
RUN npm install -g pnpm tsx typescript

# 3. 安装 Playwright 浏览器及其系统依赖
RUN mkdir -p /ms-playwright && \
    npx -y playwright@1.58.2 install chromium --with-deps

# 4. 准备项目代码 (不再维护 monorepo 结构，/app 即为项目根目录)
WORKDIR /app

# 仅拷贝项目所需的依赖描述并安装
COPY package.json ./
# 注意：在构建时需要确保 pnpm-lock.yaml 存在或生成，这里假设从 apps/agent 目录构建或拷贝
# 如果是从项目根目录构建，需要使用 COPY apps/agent/package.json ./
RUN pnpm install

# 拷贝源代码并编译
COPY . .
RUN pnpm run build

# 5. 设置沙盒运行时的工作目录
ENV WORKSPACE_DIR=/workspace
RUN mkdir -p $WORKSPACE_DIR

# 启动 Supervisor
CMD ["node", "dist/index.js"]
