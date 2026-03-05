# Netaverses

Netaverses 是一个面向 **workspace（工作空间）** 的托管与分享平台：用户可以将自己的 workspace 上传到云端（基于 Git），并在 Web 上像浏览 HuggingFace / GitHub 一样查看、分享与发现 workspace。

本仓库主要用于 **阿里云 ACK（Kubernetes）上的部署与基础设施配置**。当前阶段优先把 “workspace 托管 + Web 浏览” 打磨扎实；后续会在同一套 workspace 基础上提供一键启动虚拟机/容器运行 agent 并进行 Chat 的能力。

## 目标能力（阶段 1：托管与浏览）

- Workspace 托管：基于 Git 仓库进行版本管理与协作
- Workspace 展示：自研 Web（Hono + Svelte）用于更友好的浏览与分享
  - 目录/文件浏览
  - README 渲染与基础元信息展示
  - 可扩展的“workspace 卡片页”（类似 HuggingFace 模型卡）
- 面向 ACK 的可复用部署：一键部署、可配置、可运维

> Agent / VM 运行能力不在本阶段范围内，但会以同一份 workspace 为输入进行扩展。

## 架构概览

- **Gitea**：作为 Git Server 与权限体系的核心（repo、访问控制、审计、webhook 等）
- **Netaverses Web（规划中）**：Hono（后端 API）+ Svelte（前端）实现用户侧体验
  - 通过 Gitea API 读取 repo 内容与元信息
  - 统一身份认证（建议 OIDC），保证与 Gitea 权限一致
- **部署环境**：Alibaba Cloud ACK（Kubernetes）

## 目录结构

```
netaverses/
├── .github/
│   └── workflows/            # GitHub Actions CI/CD 配置
│       └── api-docker-build-push.yml
├── apps/
│   ├── api/                  # Netaverses API（Hono BFF）
│   │   ├── Dockerfile
│   │   ├── src/
│   │   └── package.json
│   └── web/                  # Netaverses Web（SvelteKit 前端）
└── gitea/                    # Gitea 部署配置（Helm values、脚本、文档）
    ├── README.md
    ├── PARAMETERS.md
    ├── OPTIONAL_FEATURES.md
    ├── values.template.yaml
    ├── secrets.template.yaml
    ├── check-config.sh
    ├── deploy.sh
    └── undeploy.sh
```

## 本地开发

### 前置要求

- Node.js 22+
- pnpm 9.12.1+

### 安装依赖

```bash
pnpm install
```

### 开发模式

```bash
# 启动所有应用（api + web）
pnpm dev

# 或单独启动
cd apps/api && pnpm dev
cd apps/web && pnpm dev
```

### 构建

```bash
# 构建所有应用
pnpm build

# 或单独构建 API
cd apps/api && pnpm build
```

### 代码检查

```bash
# Lint
pnpm lint

# 类型检查
pnpm typecheck
```

## CI/CD

本项目使用 GitHub Actions 进行自动化构建和镜像推送：

- **api-docker-build-push.yml**: 自动构建 API 镜像并推送到阿里云镜像仓库
  - 触发条件：push 到 main 分支、打 tag (v*)、或手动触发
  - 流程：安装依赖 → Lint → Typecheck → 构建 → Docker 镜像构建推送

### 配置 Secrets

在 GitHub 仓库设置中添加以下 Secrets：

- `ALIYUN_USERNAME`: 阿里云镜像仓库用户名
- `ALIYUN_PASSWORD`: 阿里云镜像仓库密码

## 部署目标

- Alibaba Cloud ACK（Kubernetes）
- 建议配套：
  - 独立数据库（PostgreSQL 优先）
  - 持久化存储（PVC 或对象存储方案）
  - Ingress + TLS
  - 备份策略（DB + repo 数据）

## 快速开始（部署 Gitea）

```bash
cd gitea

cp values.template.yaml values.yaml
cp secrets.template.yaml secrets.yaml

./check-config.sh
./deploy.sh
```

更多细节请参考：[`gitea/README.md`](./gitea/README.md)

## 路线图（简版）

- [x] 基础托管：Gitea 部署与参数化
- [ ] Workspace Hub Web：浏览、搜索、分享页（Hono + Svelte）
- [ ] 统一登录：OIDC / SSO 对接
- [ ] 事件联动：webhook / 索引 / 变更通知
- [ ] Agent/VM：基于 workspace 一键启动运行环境并 Chat（后续）
