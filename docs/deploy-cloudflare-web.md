# Cloudflare Worker 部署说明（前端）

本项目 `apps/web` 使用 SvelteKit，并通过 `@sveltejs/adapter-cloudflare` 部署到 Cloudflare Workers。

## 前置条件

- 已安装 `pnpm`
- 已登录 Cloudflare（`pnpm -C apps/web wrangler login`）

## 配置

- `apps/web/.env.example`：本地开发（Vite）使用
- `apps/web/wrangler.toml`：Worker 配置

生产环境推荐在 Cloudflare Dashboard / `wrangler.toml` 设置变量：

- `BFF_ORIGIN`: 指向阿里云上的 Hono API，例如 `https://api.cohub.run`

> 说明：当前 Web 端所有数据请求都通过同源 `/api/*` 反代到 Hono BFF。
> 如需在浏览器端直连 API，可以设置 `VITE_API_BASE_URL`。

## 本地预览（Worker Runtime）

```bash
pnpm i

# 准备本地 worker 环境变量
cp apps/web/.dev.vars.example apps/web/.dev.vars

pnpm -C apps/web preview
```

## 部署

```bash
pnpm i
pnpm -C apps/web build

# Production
pnpm -C apps/web wrangler deploy

# Staging
pnpm -C apps/web wrangler deploy --env staging
```
