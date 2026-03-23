FROM node:20-alpine AS builder

WORKDIR /app

# 安装 pnpm
RUN npm install -g pnpm

# 复制 package 文件
COPY package.json pnpm-lock.yaml ./
COPY packages/protocol/package.json ./packages/protocol/
COPY apps/gateway/package.json ./apps/gateway/

# 安装依赖
RUN pnpm install --frozen-lockfile

# 复制源代码
COPY packages/protocol ./packages/protocol
COPY apps/gateway ./apps/gateway
COPY tsconfig.base.json ./

# 构建
WORKDIR /app/apps/gateway
RUN pnpm build

# 生产镜像
FROM node:20-alpine

WORKDIR /app

# 复制构建产物
COPY --from=builder /app/apps/gateway/dist ./dist
COPY --from=builder /app/apps/gateway/package.json ./
COPY --from=builder /app/node_modules ./node_modules

# 设置环境变量
ENV NODE_ENV=production

# 启动
CMD ["node", "dist/index.js"]