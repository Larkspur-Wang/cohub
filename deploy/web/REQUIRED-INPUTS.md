# Cohub Web（Cloudflare Workers）部署参数收集表

如果你希望通过 GitHub Actions（workflow_dispatch）部署到 Cloudflare Workers，请准备并填写以下信息。

## 1) 必填（GitHub Secrets）

| Secret | 说明 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token（需要 Workers Scripts 编辑权限） |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |

## 2) 必填（Cloudflare Worker Variables）

当前我们拆了两个环境（两个 Worker Script 名称）：

- Production：`cohub-web`（GitHub Actions 选择 `production`）
- Staging：`cohub-web-staging`（GitHub Actions 选择 `staging`）

两者都需要配置：

| Variable | Production 示例 | Staging 示例 | 说明 |
| --- | --- | --- | --- |
| `BFF_ORIGIN` | `https://api.cohub.run` | `https://api-staging.cohub.run` | 指向 ACK 上的 BFF，用于同源 `/api/*` 反代 |

> 说明：`BFF_ORIGIN` 也可以在 `apps/web/wrangler.toml` 里配置（已提供默认值）。

## 3) GitHub Actions 手动部署

在 GitHub Actions 页面选择 `Web Deploy to Cloudflare Workers` → `Run workflow`，然后选择：
- **production**：部署到生产环境
- **staging**：部署到预发环境

## 4) 本地手动部署命令

```bash
# Production
pnpm -C apps/web wrangler deploy

# Staging
pnpm -C apps/web wrangler deploy --env staging
```
