# Netaverses - Gitea on ACK 部署配置

本项目用于在阿里云 ACK 集群上部署高可用 (HA) Gitea 实例，服务于 Netaverses 项目。

## 架构说明

本配置采用**全托管云服务**架构，所有有状态组件均使用阿里云托管服务：

| 组件 | 阿里云服务 | 用途 |
|------|-----------|------|
| 数据库 | RDS PostgreSQL | 存储 Gitea 核心数据 |
| 缓存/会话/队列 | Redis 云数据库 | 分布式缓存、Session、任务队列 |
| 代码仓库存储 | NAS (RWX) | Git 仓库文件存储 |
| 附件/LFS/头像 | OSS | 对象存储（可选，推荐） |
| 负载均衡 | ALB + CLB | Web 流量 (ALB) + SSH 流量 (CLB) |

## 快速开始

### 1. 准备阿里云资源

在购买阿里云服务前，请先阅读 [PARAMETERS.md](./PARAMETERS.md) 了解所有需要填写的参数。

### 2. 填写配置

```bash
# 进入 gitea 目录
cd gitea

# 复制模板文件
cp values.template.yaml values.yaml
cp secrets.template.yaml secrets.yaml

# 编辑配置文件（填入你的实际参数）
vim values.yaml
vim secrets.yaml
```

### 3. 创建 Kubernetes Secret

```bash
kubectl create namespace netaverses

# 创建包含所有敏感信息的 secret
kubectl apply -f secrets.yaml -n netaverses
```

### 4. 部署 Gitea

```bash
# 添加 Gitea Helm Chart 仓库
helm repo add gitea https://dl.gitea.com/charts/
helm repo update

# 部署（确保在 netaverses 命名空间下）
helm install gitea gitea/gitea -f values.yaml -n netaverses
```

### 5. 验证部署

```bash
# 查看 Pod 状态
kubectl get pods -n netaverses

# 查看服务状态
kubectl get svc -n netaverses
```

## 可禁用的可选功能

以下功能可以在**前期暂时禁用**，后续按需开启：

| 功能 | 配置项 | 建议 |
|------|--------|------|
| **代码内容搜索** | `gitea.config.indexer.REPO_INDEXER_ENABLED` | ✅ 已默认禁用（HA 架构下 bleve 不支持） |
| **Gitea Actions (CI/CD)** | `gitea.config.actions.ENABLED` | ✅ 建议前期禁用，减少资源消耗 |
| **对象存储 (OSS)** | `USE_OSS` (values.yaml 中) | ⚠️ 可先用 NAS 存储所有文件，但 OSS 性能更好 |
| **SSH 访问** | `ENABLE_SSH` (values.yaml 中) | ⚠️ 如只用 HTTP/HTTPS 可禁用 |
| **邮件通知** | `gitea.mailer` | ✅ 前期可禁用，但生产环境建议配置 |
| **联邦认证 (Federation)** | `gitea.config.federation.ENABLED` | ✅ 可禁用 |
| **指标监控** | `gitea.metrics.enabled` | ⚠️ 如有 Prometheus 建议开启 |
| **Packages 注册表** | `gitea.config.packages.ENABLED` | ⚠️ 如不需要 Maven/npm/Docker 镜像可禁用 |
| **LFS 大文件支持** | `gitea.config.lfs.ENABLED` | ⚠️ 如有大文件需求需开启 |

## 高可用说明

- **副本数**: 默认配置为 2 个 Gitea Pod
- **索引器**: Issue 搜索使用数据库 (`db`)，代码搜索已禁用
- **Session/Cache**: 使用外部 Redis，确保多 Pod 间状态共享
- **存储**: NAS 提供 RWX 共享存储，支持多 Pod 同时挂载

⚠️ **注意**: Cron 任务会在所有副本上运行（Gitea 官方限制），目前无 leader election 机制。

## 网络访问

本配置使用 **Kubernetes Gateway + Traefik** 处理 Web 流量：

- `service.http.type`: `ClusterIP` (由 Traefik Gateway 接管)
- `service.ssh.type`: `LoadBalancer` (阿里云 CLB，如启用 SSH)

请确保：
1. Traefik Gateway 已正确配置路由规则
2. 域名 DNS 已解析到 ALB/Gateway

## 后续操作

- [ ] 填写 `values.yaml` 中的所有 `CHANGE_ME` 占位符
- [ ] 创建并应用 `secrets.yaml`
- [ ] 配置 Traefik Gateway 路由
- [ ] 首次部署后通过管理员账号登录 Gitea
- [ ] 根据实际需求调整资源限制和副本数

## 故障排查

```bash
# 查看 Gitea 日志
kubectl logs -n netaverses -l app.kubernetes.io/name=gitea

# 进入 Pod 调试
kubectl exec -n netaverses -l app.kubernetes.io/name=gitea -- /bin/sh

# 检查配置生成
kubectl exec -n netaverses -l app.kubernetes.io/name=gitea -- cat /data/gitea/conf/app.ini
```
