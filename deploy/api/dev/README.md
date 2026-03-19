# Dev 环境部署

## 目录结构

```
dev/
├── values.yaml        # Dev 环境配置（可提交 git）
├── secrets.yaml       # 敏感配置（不提交 git）
├── rbac.yaml          # Dev 环境 RBAC 配置
├── deploy.sh          # 部署脚本
└── run-migration.sh   # 数据库迁移脚本
```

## 部署步骤

### 1. 配置 secrets.yaml

复制并填写敏感配置：

```bash
# 编辑 secrets.yaml，填入真实值
vim secrets.yaml
```

需要填写的字段：
- `DATABASE_URL` - 数据库连接地址
- `REDIS_URL` - Redis 连接地址
- `LITELLM_API_KEY` - LiteLLM API key

### 2. 运行数据库迁移

```bash
./run-migration.sh [IMAGE_TAG]
```

### 3. 部署应用

```bash
./deploy.sh
```

## 环境差异

| 配置项 | Prod | Dev |
|-------|------|-----|
| Namespace | netaverses | netaverses-dev |
| Sessions Namespace | netaverses-sessions | netaverses-sessions-dev |
| App Name | netaverses-api | netaverses-api-dev |
| Replicas | 1+ | 1 |
| Hostname | api.netaverses.cc | api-dev.netaverses.cc |

## 常用命令

```bash
# 查看 Pod 状态
kubectl get pods -n netaverses-dev -l app.kubernetes.io/name=netaverses-api-dev

# 查看日志
kubectl logs -n netaverses-dev -l app.kubernetes.io/name=netaverses-api-dev -f

# 查看 Session Pods
kubectl get pods -n netaverses-sessions-dev
```