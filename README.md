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
└── gitea/                      # Gitea 部署配置（Helm values、脚本、文档）
    ├── README.md
    ├── PARAMETERS.md
    ├── OPTIONAL_FEATURES.md
    ├── values.template.yaml
    ├── secrets.template.yaml
    ├── check-config.sh
    ├── deploy.sh
    └── undeploy.sh
```

> 后续会增加 `web/`、`infra/` 等目录用于承载自研 Web 与更多基础设施组件。

## 快速开始（部署 Gitea）

```bash
cd gitea

cp values.template.yaml values.yaml
cp secrets.template.yaml secrets.yaml

./check-config.sh
./deploy.sh
```

更多细节请参考：[`gitea/README.md`](./gitea/README.md)

## 部署目标

- Alibaba Cloud ACK（Kubernetes）
- 建议配套：
  - 独立数据库（PostgreSQL 优先）
  - 持久化存储（PVC 或对象存储方案）
  - Ingress + TLS
  - 备份策略（DB + repo 数据）

## 路线图（简版）

- [x] 基础托管：Gitea 部署与参数化
- [ ] Workspace Hub Web：浏览、搜索、分享页（Hono + Svelte）
- [ ] 统一登录：OIDC / SSO 对接
- [ ] 事件联动：webhook / 索引 / 变更通知
- [ ] Agent/VM：基于 workspace 一键启动运行环境并 Chat（后续）
