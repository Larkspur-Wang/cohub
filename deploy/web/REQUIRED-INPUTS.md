# Cohub Web（Cloudflare Workers）部署参数收集表

如果你希望通过 GitHub Actions（workflow_dispatch）部署到 Cloudflare Workers，请准备并填写以下信息。

## 1) 必填（GitHub Secrets）

| Secret | 说明 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token（需要 Workers Scripts 编辑权限） |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |

## 2) Web 构建环境变量

当前 Web 在构建时通过 `PUBLIC_API_ORIGIN` 注入目标 API 地址。

| 环境 | 示例值 | 说明 |
| --- | --- | --- |
| dev | `https://api-dev.cohub.live` | GitHub Actions 自动部署到 dev 时使用 |
| prod | `https://api.cohub.live` | GitHub Actions 手动部署到 prod 时使用 |

> 说明：该变量由 GitHub Actions 在构建前写入 `apps/web/.env`，无需再通过 Wrangler variables 配置。

## 3) GitHub Actions 手动部署

在 GitHub Actions 页面选择 `Web Deploy to Cloudflare Workers` → `Run workflow`，然后选择生产环境部署。

## 4) 本地手动部署命令

```bash
pnpm -C apps/web wrangler deploy
```
