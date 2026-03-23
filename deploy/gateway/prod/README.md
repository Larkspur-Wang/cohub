# Prod 环境部署

## 部署前准备

1. 复制 secrets 模板并填入真实值：
```bash
cp secrets.template.yaml secrets.yaml
# 编辑 secrets.yaml
```

2. 确保镜像已推送到仓库

## 部署

```bash
chmod +x deploy.sh
./deploy.sh
```

## 卸载

```bash
chmod +x undeploy.sh
./undeploy.sh
```