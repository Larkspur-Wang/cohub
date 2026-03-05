# Workspace API (Hono) - 部署配置

该目录用于部署 Workspace API（Hono BFF）到阿里云 ACK。

## 快速开始

```bash
cd deploy/api

# values.yaml / secrets.yaml 已在仓库中生成（含占位符），请先填写
./check-config.sh
./deploy.sh
```

## 目录结构

```
deploy/api/
├── values.template.yaml   # 配置模板（请参考）
├── secrets.template.yaml  # 密钥模板（请参考）
├── values.yaml            # 需要你填写
├── secrets.yaml           # 需要你填写
├── check-config.sh        # 配置检查脚本
├── deploy.sh              # 部署脚本
├── undeploy.sh            # 卸载脚本
└── manifests/             # Kubernetes 资源模板
```

## 默认命名

- Deployment: `netaverses-api`
- Service: `netaverses-api`
- HTTPRoute: `netaverses-api-route`

如果需要自定义，可在 `values.yaml` 中调整。
