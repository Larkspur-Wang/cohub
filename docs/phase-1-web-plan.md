# Phase 1 Plan: Workspace Hub Web (Hono + Svelte)

> Scope: 基于现有鉴权服务与 Gitea（公共仓库），完成 Web 侧的 workspace 展示与三栏 UI 原型。

## 目标与边界

- ✅ 目标
  - 新增 Hono API：统一鉴权、对接 Gitea API、对前端提供稳定接口
  - 新增 Svelte Web：workspace 详情页三栏布局（左侧文件树、中间文件展示、右侧 Chat 占位）
  - 形成可本地运行的开发链路

- ❌ 非目标（本期不做）
  - Agent/VM 运行与 Chat 后端对接
  - Gitea 私有仓库授权流程（先按公共仓库）
  - Workspace 索引/搜索/推荐

## 里程碑与任务清单

- [x] 初始化 monorepo 与基础工程
  - [x] pnpm workspace
  - [x] Biome 作为 lint
  - [x] 基础脚本（dev/build/lint/typecheck）

- [x] Hono API（apps/api）
  - [x] 环境变量与配置（AUTH_BASE_URL, GITEA_BASE_URL, GITEA_TOKEN 可选）
  - [x] 认证接口（/api/me）对接鉴权服务
  - [x] Gitea 只读接口（repo、contents、file）
  - [x] CORS 与基础错误处理

- [x] Svelte Web（apps/web）
  - [x] 三栏布局与 Obsidian 风格骨架
  - [x] 文件树（左侧，可展开）
  - [x] 文件展示（中间，文本/Markdown 基础渲染）
  - [x] Chat 占位 UI（右侧，不接后端）

- [x] 文档与环境示例
  - [x] .env.example（api/web）
  - [x] 基础运行说明（README 或 docs）

- [x] 验证
  - [x] pnpm lint
  - [x] pnpm -r typecheck
  - [x] pnpm -r build

## 完成标记

每完成一个任务会在对应的 `[ ]` 上标记为 `[x]`。
