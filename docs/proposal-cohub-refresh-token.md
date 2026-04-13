# 方案: 使用 COHUB_REFRESH_TOKEN 替代静态 LITELLM_API_KEY

## 问题

当前每个 runtime pod 启动时都注入同一个 `LITELLM_API_KEY` 环境变量（来自 API server 配置），所有用户共享同一个 key。

**风险：**
- 所有用户共用一个 key，无法做 per-user 鉴权/配额/审计
- key 泄露风险（环境变量暴露在所有 pod 中）
- 无法区分哪个用户的 agent 在调用 LLM

## 方案概述

```
┌─────────────┐
│  User Browser│
│  (Logto login│── refresh_token (offline_access scope)
│   + offline) │
└──────┬──────┘
       │ 创建 runtime 时传递 refresh_token
       ▼
┌─────────────┐
│  API Server  │── 加密存储 + 注入 pod env
│              │   COHUB_REFRESH_TOKEN
└──────┬──────┘
       ▼
┌──────────────────────────┐
│  Agent Sandbox Pod       │
│                          │
│  COHUB_REFRESH_TOKEN     │
│       │                  │
│       ▼                  │
│  ┌──────────────┐       │
│  │ TokenManager │       │
│  │ exchange()   │───────┼──→ Logto /oidc/token
│  │ get()        │       │     换取 access_token
│  └──────┬───────┘       │
│         │               │
│         ▼               │
│  authStorage.setRuntimeApiKey("cohub", accessToken)
│         │               │
│         ▼               │
│  ModelRegistry → LiteLLM (Bearer user's token)
└──────────────────────────┘
```

## 详细改动

### 1. 新增 `apps/agent/src/token-manager.ts`

Token 管理器：负责用 refresh_token 换取 access_token，带缓存和并发安全。

### 2. 修改 `apps/agent/src/env.ts`

新增 `COHUB_REFRESH_TOKEN` 环境变量。

### 3. 修改 `apps/agent/src/index.ts`

在 main() 中初始化 TokenManager，将 token 注入 AuthStorage。

### 4. 修改 `apps/api/src/runtime-sessions.ts`

- 将 `LITELLM_API_KEY` 替换为 `COHUB_REFRESH_TOKEN`
- 从用户 session 中获取 refresh_token 并传入 pod

### 5. 修改 `apps/api/src/config.ts`

移除 `litellmApiKey` 配置。

### 6. 修改 `.pi/agent/models.json`

去掉静态 `apiKey`，改用 `authHeader: true` 让 SDK 从 AuthStorage 动态获取。

### 7. 新增 API endpoint: `POST /api/runtimes/:id/token`

让 runtime 可以通过内部 API 自行换取新 token（防止 pod 启动时网络问题）。

### 8. 修改 `apps/web/src/lib/auth.ts`

导出 refresh_token 获取方法。

---

## 文件级变更详情

详见下方各个文件的实际代码。
