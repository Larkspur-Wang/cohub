#!/bin/bash
# Netaverses 卸载脚本
# 用于清理 Gitea 部署及相关资源

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 配置变量
NAMESPACE="${GITEA_NAMESPACE:-netaverses}"
RELEASE_NAME="${GITEA_RELEASE:-gitea}"

echo -e "${RED}╔════════════════════════════════════════╗${NC}"
echo -e "${RED}║   Netaverses 卸载脚本                      ║${NC}"
echo -e "${RED}╚════════════════════════════════════════╝${NC}"
echo ""

echo -e "${YELLOW}⚠️  警告：此操作将删除 Gitea 部署及相关资源${NC}"
echo ""
echo "将要删除的内容:"
echo "  - Helm Release: ${RELEASE_NAME}"
echo "  - Namespace: ${NAMESPACE}"
echo "  - 所有 Pod、Service、ConfigMap、Secret"
echo ""
echo -e "${RED}⚠️  注意：此操作不会删除以下内容:${NC}"
echo "  - 阿里云 RDS 数据库（数据保留）"
echo "  - 阿里云 NAS 存储（代码仓库保留）"
echo "  - 阿里云 OSS Bucket（附件保留）"
echo "  - 阿里云 Redis 实例"
echo ""

read -p "确认继续？(输入 yes 继续): " confirm

if [ "$confirm" != "yes" ]; then
    echo -e "${YELLOW}操作已取消${NC}"
    exit 0
fi

echo ""
echo -e "${YELLOW}[1/3] 删除 Helm Release...${NC}"
helm uninstall $RELEASE_NAME -n $NAMESPACE || true
echo -e "${GREEN}✓ Helm Release 已删除${NC}"
echo ""

echo -e "${YELLOW}[2/3] 删除命名空间...${NC}"
kubectl delete namespace $NAMESPACE --ignore-not-found
echo -e "${GREEN}✓ 命名空间已删除${NC}"
echo ""

echo -e "${YELLOW}[3/3] 清理 PVC（可选）...${NC}"
echo "PVC 默认保留，以便重新部署时可以重新挂载数据"
echo ""
read -p "是否同时删除 PVC？(输入 yes 删除): " delete_pvc

if [ "$delete_pvc" == "yes" ]; then
    kubectl delete pvc -n $NAMESPACE -l app.kubernetes.io/name=gitea || true
    echo -e "${GREEN}✓ PVC 已删除${NC}"
else
    echo -e "${BLUE}ℹ️  PVC 已保留${NC}"
fi

echo ""
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   卸载完成！                         ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""
echo "如需重新部署，运行："
echo -e "  ${BLUE}./deploy.sh${NC}"
