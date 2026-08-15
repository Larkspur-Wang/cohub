# Cohub Web（SvelteKit）部署到 Cloudflare Workers

## 前提

- 已在 Cloudflare 创建 Worker
- 已配置好 GitHub Secrets：
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`
- 已确认 API 可访问

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

