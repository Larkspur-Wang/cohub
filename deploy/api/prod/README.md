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
- `GITEA_TOKEN` - Gitea 管理员 API token（用于自动创建托管 Git 账号）
- `APP_ENCRYPTION_KEY` - 应用级加密密钥（用于加密存储影子账号密码和 access token）
- `WORKER_SECRET` - Worker 通信密钥
- `TURN_OBJECT_S3_ACCESS_KEY_ID` / `TURN_OBJECT_S3_SECRET_ACCESS_KEY` - Turn 中间消息 OSS 写入凭证
- `PUBLIC_ASSET_OSS_ACCESS_KEY_ID` / `PUBLIC_ASSET_OSS_SECRET_ACCESS_KEY` - 公开资产 OSS 写入凭证（用于用户 / Space 头像上传）
- `LOGTO_M2M_APP_ID` / `LOGTO_M2M_APP_SECRET` - Logto M2M 应用凭证

同时请确认 `values.yaml` 中已填写：
- `GITEA_MANAGED_EMAIL_DOMAIN` - 托管 Gitea 影子账号使用的邮箱域名后缀
- `PUBLIC_ASSET_OSS_ENDPOINT` / `PUBLIC_ASSET_OSS_PUBLIC_ENDPOINT` / `PUBLIC_ASSET_OSS_REGION` / `PUBLIC_ASSET_OSS_BUCKET` / `PUBLIC_ASSET_CDN_BASE_URL` - 公开资产上传与访问配置

### 2. 运行数据库迁移

```bash
# 查看帮助
./run-migration.sh -h

# 使用 values.yaml 中的 IMAGE_TAG 运行迁移
./run-migration.sh

# 使用指定镜像 tag
./run-migration.sh v1.2.3

# 查看迁移状态
./run-migration.sh -s

# 查看迁移日志
./run-migration.sh -l

# 强制重新运行（删除已存在的 job）
./run-migration.sh -f
```

Migration 使用 Drizzle ORM，基于 `apps/api/drizzle/` 目录下的 SQL 文件执行。

### 3. 部署应用

```bash
./deploy.sh
```

## 常用命令

```bash
# 查看 Pod 状态
kubectl get pods -n cohub -l app.kubernetes.io/name=cohub-api

# 查看日志
kubectl logs -n cohub -l app.kubernetes.io/name=cohub-api -f

# 查看 Session Pods
kubectl get pods -n cohub-sessions
```