# Prod 环境部署

## 目录结构

```
prod/
├── values.yaml              # Prod 环境配置（可提交 git）
├── secrets.yaml             # 敏感配置（不提交 git）
├── secrets.template.yaml
├── deploy.sh                # 部署脚本
└── undeploy.sh              # 卸载脚本
```

## 部署前准备

1. 配置 `values.yaml`，确认以下关键配置：
   - `IMAGE_TAG` - 镜像版本
   - `API_BASE_URL` - API 服务地址（默认 `http://cohub-api:8787`）
   - `GATEWAY_HOSTNAME` - 外部访问域名（默认 `gateway.cohub.run`）
   - `ROUTE_ENABLED` - 是否启用外部路由（默认 `true`）

2. 复制 secrets 模板并填入真实值：
```bash
cp secrets.template.yaml secrets.yaml
# 编辑 secrets.yaml，填入 REDIS_URL 等敏感配置
```

3. 确保镜像已推送到仓库

## 部署

```bash
chmod +x deploy.sh
./deploy.sh
```

## 常用命令

```bash
# 查看 Pod 状态
kubectl get pods -n cohub -l app.kubernetes.io/name=cohub-gateway

# 查看日志
kubectl logs -n cohub -l app.kubernetes.io/name=cohub-gateway -f

# 查看 Service
kubectl get svc -n cohub cohub-gateway

# 查看 HTTPRoute（如启用）
kubectl get httproute -n cohub cohub-gateway-route
```

## 卸载

```bash
chmod +x undeploy.sh
./undeploy.sh
```

## Values files

This repository ships `values.example.yaml` only.

```bash
cp values.example.yaml values.yaml
# edit values.yaml for your environment
./deploy.sh
```

Do not commit real `values.yaml` or `secrets.yaml`.

