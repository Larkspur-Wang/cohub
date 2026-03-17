# 使用轻量的 Node.js 24 镜像作为基础
FROM node:24-bookworm-slim

# 设置环境变量
ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
# 确保 Playwright 知道在哪里找到浏览器
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# 1. 安装基础系统工具、Python 和多媒体/字体依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl git wget jq ca-certificates \
    python3 python3-pip python3-venv \
    ffmpeg imagemagick libimage-exiftool-perl \
    unzip vim tree tmux htop xz-utils \
    fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

# 设置 Python 软链接
RUN ln -sf /usr/bin/python3 /usr/bin/python

# 2. 全局安装 pnpm
RUN npm install -g pnpm

# 3. 安装 Playwright 浏览器及其系统依赖 (官方推荐方式)
RUN mkdir -p /ms-playwright && \
    npx -y playwright@1.58.2 install chromium --with-deps

# 4. 准备项目代码
# 我们直接将 apps/agent 的内容拷贝到 /app
WORKDIR /app

# 仅拷贝依赖描述
COPY apps/agent/package.json ./
# 安装所有依赖（--prod=false 确保安装 devDependencies）
RUN pnpm install --prod=false

# 拷贝 agent 源码
COPY apps/agent/ ./

# 编译代码 (只运行当前目录下的 build)
RUN pnpm run build

# 5. 设置沙盒运行时的工作目录
ENV WORKSPACE_DIR=/workspace
RUN mkdir -p $WORKSPACE_DIR

# 启动 Supervisor
CMD ["node", "dist/index.js"]
