# Cohub Web（SvelteKit）部署到 Cloudflare Workers

该目录提供 `apps/web` 部署到 Cloudflare Workers 的最小指引与检查清单。

## 前置条件

- Cloudflare 账号
- 安装 `pnpm`
- 安装并登录 wrangler

```bash
pnpm -C apps/web wrangler login
```

## 生产配置（必须）

在 Cloudflare Dashboard 或 `apps/web/wrangler.toml` 中配置：

- `BFF_ORIGIN`: 指向阿里云 ACK 上的 API，例如 `https://api.cohub.run`

> Web 端会通过同源 `/api/*` 反代到 BFF，所以浏览器不需要跨域访问阿里云。

## 本地预览（Worker Runtime）

```bash
pnpm i

cp apps/web/.dev.vars.example apps/web/.dev.vars

pnpm -C apps/web preview
```

## 构建与部署

### GitHub Actions（推荐）

在 GitHub Actions 页面选择 `Web Deploy to Cloudflare Workers` → `Run workflow`，然后选择环境：
- **production**：部署到生产环境
- **staging**：部署到预发环境

### 本地手动部署

```bash
pnpm i

pnpm -C apps/web lint
pnpm -C apps/web typecheck
pnpm -C apps/web build

# Production
pnpm -C apps/web wrangler deploy

# Staging
pnpm -C apps/web wrangler deploy --env staging
```

## 验证

部署后访问：

- `https://web.<your-domain>/`：能打开首页
- 输入 token 后应能调用 `/api/me` 成功
- 打开 `https://web.<your-domain>/workspaces/<owner>/<repo>`：能展示文件树/文件内容
