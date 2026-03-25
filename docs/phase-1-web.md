# Cohub Phase 1: Workspace Hub Web

本期目标：完成 workspace 的 **浏览与分享页原型**，后端通过 **Hono API** 对接 Gitea（公共仓库），并复用已有鉴权服务做登录态校验。

## 目录

- `apps/api`: Hono API
- `apps/web`: SvelteKit Web
- `deploy/gitea/`: Gitea 部署配置

## 本地开发

### 1) 启动 API（Hono）

```bash
cd apps/api

# 复制环境变量模板
cp .env.example .env

pnpm dev
```

### 2) 启动 Web（SvelteKit）

```bash
cd apps/web

cp .env.example .env
pnpm dev
```

打开 `http://localhost:5173`。

## 环境变量

### apps/api

- `AUTH_BASE_URL`: 现有鉴权服务的 base URL（例如 `https://bff.talesofai.cn`）
- `GITEA_BASE_URL`: Gitea base URL（例如 `https://gitea.cohub.run`）
- `GITEA_TOKEN`: （可选）Gitea API token；若仓库是 public 可不填
- `WEB_ORIGIN`: （可选）允许的 Web Origin，用于 CORS；本地可填 `http://localhost:5173`
- `TOKEN_COOKIE_NAME`: （可选）存储 token 的 cookie 名称，默认 `x_token`
- `PORT`: （可选）API 端口，默认 `8787`

### apps/web

- `PUBLIC_API_ORIGIN`: 前端构建时注入的 API 地址
  - 本地开发示例：`http://localhost:8787`
  - dev 部署示例：`https://api-dev.cohub.run`
  - prod 部署示例：`https://api.cohub.run`

## 验证

```bash
pnpm lint
pnpm typecheck
pnpm build
```
