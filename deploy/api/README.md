# Cohub API 部署

## 目录结构

```
deploy/api/
├── manifests/              # K8s 资源模板
│   ├── configmap.tmpl.yaml
│   ├── deployment.tmpl.yaml
│   ├── service.tmpl.yaml
│   ├── httproute.tmpl.yaml
│   └── migration-job.tmpl.yaml
├── prod/                   # Prod 环境
│   ├── values.yaml
│   ├── secrets.yaml        # 不提交 git
│   ├── rbac.yaml
│   ├── deploy.sh
│   ├── run-migration.sh
│   └── README.md
└── dev/                    # Dev 环境
    ├── values.yaml
    ├── secrets.yaml        # 不提交 git
    ├── rbac.yaml
    ├── deploy.sh
    ├── run-migration.sh
    └── README.md
```

## 环境差异

| 配置项 | Prod | Dev |
|-------|------|-----|
| Namespace | `cohub` | `cohub-dev` |
| Sessions Namespace | `cohub-sessions` | `cohub-sessions-dev` |
| App Name | `cohub-api` | `cohub-api-dev` |
| Hostname | `api.cohub.run` | `api-dev.cohub.run` |
| ENV | `prod` | `dev` |

## 快速开始

### Prod 环境

```bash
cd deploy/api/prod

# 1. 配置 secrets
cp secrets.template.yaml secrets.yaml
vim secrets.yaml

# 2. 运行迁移
./run-migration.sh

# 3. 部署
./deploy.sh
```

### Dev 环境

```bash
cd deploy/api/dev

# 1. 配置 secrets
vim secrets.yaml

# 2. 运行迁移
./run-migration.sh

# 3. 部署
./deploy.sh
```

## 前置条件

- [ ] `cohub-agent-pvc` PVC 已创建（sessions namespace 中）
- [ ] 镜像已推送到 registry
- [ ] secrets.yaml 已配置
- [ ] CI 已配置 `GITEA_NPM_TOKEN` secret（仅构建期使用，用于读取 `git.talesofai.com/api/packages/talesofai/npm/` 私有 npm 包）

## 可选 Billing 配置

API 支持可插拔 Talesofai Billing。`secrets.yaml` 中以下三项全部非空时启用，任意一项留空时自动禁用 billing：

- `TALESOFAI_BILLING_BASE_URL`
- `TALESOFAI_BILLING_BUSINESS_KEY`
- `TALESOFAI_BILLING_ADMIN_API_KEY`

禁用时 API 仍可启动，billing preflight 默认放行，usage record 会返回 disabled 状态且不会写入 billing。
