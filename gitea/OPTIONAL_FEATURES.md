# 可选功能配置说明

本文档详细说明可以**前期暂时禁用**的功能，帮助你在项目初期简化架构、节省资源。

---

## ✅ 已默认禁用的功能（无需额外配置）

以下功能在 `values.template.yaml` 中**已默认禁用**，适合前期不需要使用的场景：

| 功能 | 配置项 | 说明 |
|------|--------|------|
| **Gitea Actions (CI/CD)** | `gitea.config.actions.ENABLED: false` | Actions 需要额外的 Runner 支持，前期可禁用 |
| **代码内容搜索** | `gitea.config.indexer.REPO_INDEXER_ENABLED: false` | HA 架构下 bleve 不支持，必须禁用 |
| **联合认证 (Federation)** | `gitea.config.federation.ENABLED: false` | ActivityPub 协议，国内使用场景少 |
| **内置数据库** | `postgresql.enabled: false` | 已配置使用阿里云 RDS |
| **内置 Redis** | `valkey-cluster.enabled: false` | 已配置使用阿里云 Redis |
| **内置 MinIO** | `minio.enabled: false` | 可选使用阿里云 OSS |

---

## ⚠️ 可按需禁用的功能

以下功能当前为**启用状态**，但你可以根据实际情况禁用：

### 1. Packages 注册表

**用途**: 存储 Maven、npm、NuGet、Docker 等包

**禁用场景**: 仅使用 Git 代码托管，不需要包管理功能

**配置方法**:
```yaml
gitea:
  config:
    packages:
      ENABLED: false
```

**影响**: 用户无法发布/安装包，但不影响代码仓库功能

---

### 2. LFS 大文件支持

**用途**: 存储 Git LFS 大文件（如图片、视频、二进制文件）

**禁用场景**: 仅托管纯代码仓库，无大文件需求

**配置方法**:
```yaml
gitea:
  config:
    lfs:
      ENABLED: false
```

**影响**: 无法使用 `git lfs push/pull` 命令

---

### 3. SSH 访问

**用途**: 支持 `git clone git@domain.com:user/repo.git` 方式克隆

**禁用场景**: 仅使用 HTTPS 方式访问，或统一通过 Token 认证

**配置方法**:
```yaml
# values.yaml
gitea:
  config:
    server:
      START_SSH_SERVER: false

service:
  ssh:
    type: ClusterIP  # 改为 ClusterIP，不创建 CLB
```

**影响**: 
- ✅ 节省一个 CLB 负载均衡费用（约 30 元/月）
- ❌ 无法使用 SSH 方式克隆/推送
- ✅ 仍可使用 HTTPS + Token 方式

---

### 4. 邮件通知

**用途**: 发送注册确认、密码重置、Issue 通知等邮件

**禁用场景**: 前期内部测试，或通过其他方式通知

**配置方法**:
```yaml
# values.yaml - 不配置 mailer 部分即可
# 或显式禁用
gitea:
  config:
    # 不设置 mailer 相关配置
```

**影响**:
- ❌ 用户注册后无法收到确认邮件
- ❌ 忘记密码功能无法使用
- ❌ Issue/PR 通知无法发送邮件
- ✅ 管理员可在后台手动激活用户

**建议**: 生产环境建议配置，可使用阿里云 DirectMail 或腾讯企业邮

---

### 5. 指标监控 (Metrics)

**用途**: 暴露 Prometheus 格式的监控指标

**禁用场景**: 无 Prometheus 监控系统

**配置方法**:
```yaml
gitea:
  metrics:
    enabled: false
```

**影响**: 无法在 Grafana 中查看 Gitea 监控面板

**建议**: 如有监控系统建议开启，便于观察性能

---

### 6. 用户自助注册

**用途**: 允许用户自行注册账号

**禁用场景**: 企业内部使用，统一由管理员创建账号

**配置方法**:
```yaml
gitea:
  config:
    service:
      DISABLE_REGISTRATION: true
```

**影响**: 登录页面不再显示"注册"按钮

---

### 7. Webhooks

**用途**: 代码推送时触发外部系统（如 CI/CD、钉钉通知）

**禁用场景**: 无外部集成需求

**配置方法**:
```yaml
gitea:
  config:
    webhook:
      ALLOWED_HOST_LIST: ""  # 清空表示禁用所有 webhook
```

**影响**: 仓库无法配置 Webhook

---

## 📊 资源节省对比

| 配置方案 | 副本数 | 预估 CPU | 预估内存 | 负载均衡 | 适用场景 |
|---------|--------|---------|---------|---------|---------|
| **完整功能** | 2 | 2 Core | 4Gi | ALB + CLB | 生产环境 |
| **精简版** | 2 | 1 Core | 2Gi | ALB only | 测试/小团队 |
| **极简版** | 1 | 500m | 1Gi | ALB only | 个人/演示 |

**精简版配置建议**:
```yaml
replicaCount: 2

resources:
  requests:
    cpu: 250m
    memory: 512Mi
  limits:
    cpu: 1000m
    memory: 2Gi

gitea:
  config:
    packages:
      ENABLED: false
    lfs:
      ENABLED: false

service:
  ssh:
    type: ClusterIP  # 不创建 CLB
```

---

## 🔄 后续启用方法

所有禁用的功能都可以**随时重新启用**，无需迁移数据：

1. 修改 `values.yaml` 中对应配置
2. 执行 `helm upgrade gitea gitea/gitea -f values.yaml -n gitea`
3. Gitea 会自动应用新配置

**注意**: 
- 启用 OSS 存储后，需手动迁移原有附件（如之前使用本地存储）
- 启用 Actions 后，需额外部署 Runner

---

## 📋 推荐配置（按阶段）

### 阶段一：内部测试（1-10 人）
```yaml
replicaCount: 1
gitea.config.actions.ENABLED: false
gitea.config.packages.ENABLED: false
service.ssh.type: ClusterIP
```

### 阶段二：小团队使用（10-50 人）
```yaml
replicaCount: 2
gitea.config.actions.ENABLED: false
gitea.config.packages.ENABLED: true
service.ssh.type: LoadBalancer
```

### 阶段三：生产环境（50+ 人）
```yaml
replicaCount: 2-3
gitea.config.actions.ENABLED: true
gitea.config.packages.ENABLED: true
service.ssh.type: LoadBalancer
gitea.metrics.enabled: true
```

---

## ❓ 常见问题

**Q: 禁用 Packages 后，已有的包会丢失吗？**  
A: 不会。数据仍存储在 NAS/OSS 中，重新启用后可继续访问。

**Q: 可以先禁用 SSH，后期再启用吗？**  
A: 可以。启用后需确保 DNS 解析和 CLB 配置正确。

**Q: Actions 禁用后，已有的 Workflow 会保留吗？**  
A: 会保留。重新启用后可继续运行。

**Q: 邮件禁用后，用户如何找回密码？**  
A: 需联系管理员在后台重置密码。建议生产环境配置邮件。
