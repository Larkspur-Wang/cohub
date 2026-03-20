# Cohub Web（Cloudflare Workers）部署参数收集表

如果你希望通过 GitHub Actions（workflow_dispatch）部署到 Cloudflare Workers，请准备并填写以下信息。

## 1) 必填（GitHub Secrets）

| Secret | 说明 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token（需要 Workers Scripts 编辑权限） |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |

## 2) 必填（Cloudflare Worker Variables）

当前仅使用一个生产环境 Worker：

- Production：`cohub-web`

需要配置：

| Variable | Production 示例 | 说明 |
| --- | --- | --- |
| `BFF_ORIGIN` | `https://api.cohub.run` | 指向 ACK 上的 BFF，用于同源 `/api/*` 反代 |

> 说明：`BFF_ORIGIN` 也可以在 `apps/web/wrangler.toml` 里配置（已提供默认值）。

## 3) GitHub Actions 手动部署

在 GitHub Actions 页面选择 `Web Deploy to Cloudflare Workers` → `Run workflow`，然后选择生产环境部署。

## 4) 本地手动部署命令

```bash
pnpm -C apps/web wrangler deploy
```
