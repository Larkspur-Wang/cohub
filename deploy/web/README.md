# Cohub Web（SvelteKit）部署到 Cloudflare Workers

## 前提

- 已在 Cloudflare 创建 Worker
- 已配置好 GitHub Secrets：
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`
- 已确认 API 可访问

> 主域名的 Worker 路由已写入对应 Wrangler 配置，并启用 `assets.run_worker_first`。独立域名位于其它 Zone，其 Worker 通配路由在部署侧创建（不写入仓库）。

## App 独立域名（可选）

已发布公开 App 的独立域名由部署配置决定，未配置时该功能关闭（API 不返回独立地址，App 也无法从独立域名打开）。

| 位置 | 配置 | 说明 |
|------|------|------|
| API | `APP_STANDALONE_HOST_TEMPLATE` | 见 `deploy/api/*`；`{id}` 代入 App ID，如 `{id}.apps.example.com` |
| Web | `PUBLIC_APP_STANDALONE_HOST_TEMPLATE` | 构建期注入，取值自 GitHub Variable `APP_STANDALONE_HOST_TEMPLATE_DEV` / `APP_STANDALONE_HOST_TEMPLATE_PROD` |

启用独立域名还需在目标 Zone 完成：代理状态的通配 DNS 记录（如 `*.apps.example.com`）、覆盖该通配的 TLS 证书（Universal SSL 仅覆盖一级通配，二级通配需另行签发），以及指向 `cohub-web-dev` / `cohub-web` 的 Worker 通配路由。

## 环境配置

| 环境 | Worker 名称 | 配置文件 | API 地址 |
|------|------------|---------|---------|
| dev | cohub-web-dev | `wrangler.toml` | `https://api-dev.cohub.live` |
| prod | cohub-web | `wrangler.prod.toml` | `https://api.cohub.live` |

## 本地部署

```bash
# 安装依赖
pnpm install

# 部署到 dev
pnpm -C apps/web build && pnpm -C apps/web deploy

# 部署到 prod
pnpm -C apps/web build && pnpm -C apps/web deploy:prod
```

## CI/CD

| 触发方式 | 部署环境 |
|---------|---------|
| push 到 `main` 分支 | dev（自动） |
| 手动触发 | 可选 dev 或 prod |

## Deploy inputs

Web deploy is driven by Cloudflare wrangler configs and CI env injection (see `.github/workflows/web-deploy-cloudflare.yml`). There is no Kubernetes `values.yaml` / `deploy.sh` for this component.

Do not commit real secrets or production-only credentials.

