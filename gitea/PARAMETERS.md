# 配置参数说明

本文档详细说明 `values.yaml` 和 `secrets.yaml` 中需要填写的所有参数。

---

## 必填参数（生产环境）

### 1. 基础配置

| 参数 | 说明 | 示例 |
|------|------|------|
| `GITEA_DOMAIN` | Gitea Web 访问域名 | `git.example.com` |
| `GITEA_ROOT_URL` | Gitea 完整访问 URL | `https://git.example.com` |
| `GITEA_SSH_DOMAIN` | SSH 克隆域名（如启用 SSH） | `git.example.com` |
| `NAMESPACE` | Kubernetes 命名空间 | `gitea` |

### 2. 阿里云 RDS PostgreSQL

| 参数 | 说明 | 示例 |
|------|------|------|
| `RDS_HOST` | RDS 内网连接地址 | `pgm-bp1xxxxx.pg.rds.aliyuncs.com` |
| `RDS_PORT` | RDS 端口 | `5432` |
| `RDS_DATABASE` | 数据库名称 | `gitea` |
| `RDS_USERNAME` | 数据库用户名 | `gitea_user` |
| `RDS_PASSWORD` | 数据库密码（填入 secrets.yaml） | - |

> 💡 **建议**: 在 RDS 控制台创建账号时，授予 `读写` 权限即可。

### 3. 阿里云 Redis

| 参数 | 说明 | 示例 |
|------|------|------|
| `REDIS_HOST` | Redis 内网连接地址 | `r-bp1xxxxx.redis.rds.aliyuncs.com` |
| `REDIS_PORT` | Redis 端口 | `6379` |
| `REDIS_PASSWORD` | Redis 密码（填入连接字符串中） | - |

> 💡 **注意**: 只需填写连接字符串，格式为 `redis://:password@host:port/0`

### 4. 阿里云 NAS（代码仓库存储）

| 参数 | 说明 | 示例 |
|------|------|------|
| `NAS_STORAGE_CLASS` | NAS StorageClass 名称 | `alicloud-nas` |
| `NAS_SIZE` | PVC 申请容量（NAS 按实际使用计费） | `500Gi` |
| `NAS_MOUNT_POINT` | NAS 挂载点地址（创建 PVC 时需要） | `0xxxxxx-xxxx.cn-hangzhou.nas.aliyuncs.com` |

> 💡 **重要**: 确保 StorageClass 支持 `ReadWriteMany (RWX)` 访问模式

### 5. 管理员账号

| 参数 | 说明 | 示例 |
|------|------|------|
| `ADMIN_USERNAME` | 管理员用户名（填入 `secrets.yaml`） | `gitea_admin` |
| `ADMIN_PASSWORD` | 管理员密码（填入 `secrets.yaml`） | - |
| `ADMIN_EMAIL` | 管理员邮箱（填入 `values.yaml`） | `admin@example.com` |

---

## 可选参数

### 6. 阿里云 OSS（对象存储，可选但推荐）

| 参数 | 说明 | 示例 |
|------|------|------|
| `USE_OSS` | 是否启用 OSS 存储附件 | `true` / `false` |
| `OSS_ENDPOINT` | OSS 内网 Endpoint | `oss-cn-hangzhou-internal.aliyuncs.com` |
| `OSS_BUCKET` | Bucket 名称 | `my-gitea-bucket` |
| `OSS_REGION` | Bucket 所在地域 | `cn-hangzhou` |
| `OSS_ACCESS_KEY_ID` | AccessKey ID（填入 secrets.yaml） | - |
| `OSS_ACCESS_KEY_SECRET` | AccessKey Secret（填入 secrets.yaml） | - |

> 💡 **建议**: 在 RAM 控制台创建子账号，仅授予该 Bucket 的读写权限

### 7. SSH 访问

| 参数 | 说明 | 示例 |
|------|------|------|
| `ENABLE_SSH` | 是否启用 SSH Git 访问 | `true` / `false` |
| `SSH_PORT` | SSH 服务端口（CLB 监听端口） | `22` |

> 💡 **注意**: 启用 SSH 会自动创建阿里云 CLB 负载均衡

### 8. 功能开关

| 参数 | 说明 | 默认值 | 建议 |
|------|------|--------|------|
| `ENABLE_ACTIONS` | Gitea Actions (CI/CD) | `false` | 前期禁用，减少资源消耗 |
| `ENABLE_PACKAGES` | Packages 注册表 | `true` | 如需 Maven/npm 镜像则开启 |
| `ENABLE_LFS` | LFS 大文件支持 | `true` | 如有大文件需求则开启 |
| `ENABLE_MAILER` | 邮件通知 | `false` | 生产环境建议配置 |
| `ENABLE_METRICS` | Prometheus 指标 | `false` | 如有监控需求则开启 |

### 9. 邮件配置（可选）

| 参数 | 说明 | 示例 |
|------|------|------|
| `MAILER_ENABLED` | 是否启用邮件 | `false` |
| `MAILER_HOST` | SMTP 服务器地址 | `smtp.example.com` |
| `MAILER_PORT` | SMTP 端口 | `587` |
| `MAILER_USERNAME` | SMTP 用户名 | `noreply@example.com` |
| `MAILER_PASSWORD` | SMTP 密码（填入 secrets.yaml） | - |
| `MAILER_FROM` | 发件人邮箱 | `noreply@example.com` |

---

## 资源限制（可选）

| 参数 | 说明 | 默认值 | 建议（大量用户） |
|------|------|--------|-----------------|
| `REPLICA_COUNT` | Gitea Pod 副本数 | `2` | `2-5` |
| `CPU_REQUEST` | CPU 请求 | `100m` | `500m` |
| `CPU_LIMIT` | CPU 限制 | `1000m` | `2000m` |
| `MEMORY_REQUEST` | 内存请求 | `256Mi` | `1Gi` |
| `MEMORY_LIMIT` | 内存限制 | `1024Mi` | `4Gi` |

---

## 填写检查清单

在部署前，请确认以下参数已填写：

- [ ] `GITEA_DOMAIN` - Web 访问域名
- [ ] `GITEA_ROOT_URL` - 完整访问 URL
- [ ] `RDS_HOST` - RDS 内网地址
- [ ] `RDS_USERNAME` - 数据库用户名
- [ ] `REDIS_HOST` - Redis 内网地址
- [ ] `REDIS_PASSWORD` - Redis 密码
- [ ] `NAS_STORAGE_CLASS` - NAS StorageClass
- [ ] `ADMIN_USERNAME` - 管理员用户名
- [ ] `ADMIN_PASSWORD` - 管理员密码

---

## 安全提示

1. **不要将 `secrets.yaml` 提交到 Git 仓库**（已配置 `.gitignore`）
2. 建议使用 **Kubernetes External Secrets** 或 **阿里云 Secrets Manager** 管理敏感信息
3. RDS 和 Redis 建议配置 **白名单**，仅允许 ACK 集群访问
4. OSS 建议使用 **RAM 子账号**，仅授予最小必要权限
