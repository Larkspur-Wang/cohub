# Prod 环境部署

## 目录结构

```
prod/
├── values.yaml        # Prod 环境配置（可提交 git）
├── secrets.yaml       # 敏感配置（不提交 git）
├── secrets.template.yaml
├── rbac.yaml          # Prod 环境 RBAC 配置
├── deploy.sh          # 部署脚本
├── run-migration.sh   # 数据库迁移脚本
└── undeploy.sh        # 卸载脚本
```

## 部署步骤

### 1. 配置 secrets.yaml

复制并填写敏感配置：

```bash
cp secrets.template.yaml secrets.yaml
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

## 常用命令

```bash
# 查看 Pod 状态
kubectl get pods -n netaverses -l app.kubernetes.io/name=netaverses-api

# 查看日志
kubectl logs -n netaverses -l app.kubernetes.io/name=netaverses-api -f

# 查看 Session Pods
kubectl get pods -n netaverses-sessions
```