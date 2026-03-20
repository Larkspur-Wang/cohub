# Cohub Web（SvelteKit）部署到 Cloudflare Workers

## 前提

- 已在 Cloudflare 创建 Worker
- 已配置好 GitHub Secrets：
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`
- 已确认 API 可访问，例如：`https://api.cohub.run`

## 关键变量

- `BFF_ORIGIN`: 指向阿里云 ACK 上的 API，例如 `https://api.cohub.run`

默认值已写在：`apps/web/wrangler.toml`

## 本地部署

```bash
pnpm install
pnpm -C apps/web build
pnpm -C apps/web wrangler deploy
```

## GitHub Actions 部署

可通过对应 workflow 手动触发部署到生产环境。
